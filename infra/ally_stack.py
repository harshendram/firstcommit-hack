"""Ally on AWS.

Edge          Amplify Hosting (Next.js) → Amazon Cognito → API Gateway HTTP API (JWT authorizer)
Compute       AWS Lambda (FastAPI behind the Lambda Web Adapter, container image)
Reasoning     Amazon Bedrock — Amazon Nova through a cross-region inference profile
Voice         Amazon Transcribe (streaming, en-IN/hi-IN identification) + Amazon Polly (Kajal)
Documents     Amazon Textract + Amazon Comprehend Medical
Data          Amazon DynamoDB, single table, PITR on, backed up by AWS Backup
Workflow      AWS Step Functions (STANDARD) with `waitForTaskToken` for the escalation chain
Schedule      Amazon EventBridge, one-minute sweep
Notify        Amazon SNS (SMS + ops topic) and Amazon Connect (outbound voice), Web Push
Storage       Amazon S3 for discharge documents and staged call audio
Durability    Amazon SQS dead-letter queues on every asynchronous path
Observability Amazon CloudWatch metrics, alarms and a dashboard; AWS X-Ray on every function

Secrets (VAPID keys, device key, HMAC secret) live in one AWS Secrets Manager bundle created by
ally/scripts/put_secrets.py before the first deploy — CloudFormation cannot write secret values.
Speech, reasoning and documents need no API keys at all: they use the function's IAM role.
"""

from __future__ import annotations

import json
from pathlib import Path

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigatewayv2 as apigw
from aws_cdk import aws_apigatewayv2_authorizers as authorizers
from aws_cdk import aws_apigatewayv2_integrations as integrations
from aws_cdk import aws_backup as backup
from aws_cdk import aws_cloudwatch as cw
from aws_cdk import aws_cloudwatch_actions as cw_actions
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_secretsmanager as secretsmanager
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sqs as sqs
from aws_cdk import aws_stepfunctions as sfn
from constructs import Construct

from escalation_asl import definition

ALLY_DIR = str(Path(__file__).resolve().parent.parent / "ally")
# Created by ally/scripts/put_secrets.py before the first deploy (CloudFormation cannot write secret values).
SECRET_NAME = "ally/runtime"


class AllyStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        ctx = self.node.try_get_context
        model_id = ctx("bedrockModelId") or "us.amazon.nova-2-lite-v1:0"
        # A second region for the same model. One Bedrock turn that throttles or 5xxs in the
        # primary region is retried here before Ally reports llm_unavailable.
        failover_region = ctx("bedrockFailoverRegion") or "us-west-2"
        web_origins = [o for o in (ctx("webOrigins") or "http://localhost:3000").split(",") if o]
        contact_timeout = int(ctx("escalationContactTimeout") or 180)
        investigation_window = str(ctx("investigationWindowMin") or 15)
        # New accounts have a total concurrency limit of 10, which rejects reserved/provisioned
        # concurrency. Both are opt-in once a quota increase is approved.
        provisioned = int(ctx("provisionedConcurrency") or 0)
        worker_reserved = ctx("workerReservedConcurrency")
        arm = (ctx("architecture") or "arm64") == "arm64"
        architecture = lambda_.Architecture.ARM_64 if arm else lambda_.Architecture.X86_64
        platform = ecr_assets.Platform.LINUX_ARM64 if arm else ecr_assets.Platform.LINUX_AMD64

        # ---- data ---------------------------------------------------------------------------
        table = dynamodb.Table(
            self,
            "AllyTable",
            table_name="Ally",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )
        table.add_global_secondary_index(
            index_name="gsi1",
            partition_key=dynamodb.Attribute(name="gsi1pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="gsi1sk", type=dynamodb.AttributeType.STRING),
        )

        # PITR rewinds to any second in the last 35 days; AWS Backup keeps restorable copies for
        # longer than that, which is what an accidental table delete actually needs.
        backup.BackupPlan(
            self,
            "AllyBackupPlan",
            backup_plan_name="AllyDaily",
            backup_plan_rules=[
                backup.BackupPlanRule(
                    rule_name="DailyRetain35Days",
                    schedule_expression=events.Schedule.cron(hour="3", minute="0"),
                    delete_after=Duration.days(35),
                    start_window=Duration.hours(1),
                    completion_window=Duration.hours(3),
                )
            ],
        ).add_selection(
            "AllyTableSelection",
            resources=[backup.BackupResource.from_dynamo_db_table(table)],
        )

        # ---- storage ------------------------------------------------------------------------
        def bucket(construct_id: str, prefix: str, expire_days: int) -> s3.Bucket:
            return s3.Bucket(
                self,
                construct_id,
                encryption=s3.BucketEncryption.S3_MANAGED,
                enforce_ssl=True,
                block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
                versioned=False,
                lifecycle_rules=[
                    s3.LifecycleRule(
                        prefix=prefix,
                        expiration=Duration.days(expire_days),
                        abort_incomplete_multipart_upload_after=Duration.days(1),
                    )
                ],
                removal_policy=RemovalPolicy.RETAIN,
            )

        # Discharge PDFs only exist long enough for Textract to read them.
        documents = bucket("AllyDocuments", "discharge/", expire_days=7)
        # Call audio is fetched once by Amazon Connect through a 15-minute presigned URL.
        call_audio = bucket("AllyCallAudio", "calls/", expire_days=1)

        # ---- durability ---------------------------------------------------------------------
        # Every asynchronous path gets a dead-letter queue, so a failure is a queue depth you can
        # alarm on rather than a log line nobody reads.
        notification_dlq = sqs.Queue(
            self,
            "NotificationDlq",
            queue_name="ally-notifications-dlq",
            retention_period=Duration.days(14),
            enforce_ssl=True,
        )
        worker_dlq = sqs.Queue(
            self,
            "WorkerDlq",
            queue_name="ally-worker-dlq",
            retention_period=Duration.days(14),
            enforce_ssl=True,
        )

        ops_topic = sns.Topic(
            self,
            "OpsTopic",
            topic_name="ally-ops",
            display_name="Ally operations",
        )

        # ---- identity -----------------------------------------------------------------------
        pool = cognito.UserPool(
            self,
            "AllyUsers",
            user_pool_name="ally-family",
            self_sign_up_enabled=False,
            sign_in_aliases=cognito.SignInAliases(username=True),
            custom_attributes={
                "parent_id": cognito.StringAttribute(mutable=True, min_len=1, max_len=40),
                "member_id": cognito.StringAttribute(mutable=True, min_len=1, max_len=40),
            },
            password_policy=cognito.PasswordPolicy(min_length=10),
            account_recovery=cognito.AccountRecovery.NONE,
            removal_policy=RemovalPolicy.RETAIN,
        )
        client = pool.add_client(
            "AllyWeb",
            auth_flows=cognito.AuthFlow(user_srp=True, user_password=True),
            generate_secret=False,
            id_token_validity=Duration.hours(1),
            access_token_validity=Duration.hours(1),
            refresh_token_validity=Duration.days(30),
            read_attributes=cognito.ClientAttributes()
            .with_standard_attributes(preferred_username=True)
            .with_custom_attributes("parent_id", "member_id"),
        )
        for group in ("parent", "family"):
            cognito.CfnUserPoolGroup(self, f"Group{group.title()}", user_pool_id=pool.user_pool_id, group_name=group)

        # ---- compute ------------------------------------------------------------------------
        common_env = {
            "ALLY_TABLE": table.table_name,
            "BEDROCK_MODEL_ID": model_id,
            "BEDROCK_FAILOVER_REGION": failover_region,
            "ALLY_SECRET_NAME": SECRET_NAME,
            "ALLY_TRANSCRIBE_MODE": ctx("transcribeMode") or "identify",
            "ALLY_POLLY_VOICE": ctx("pollyVoice") or "Kajal",
            "ALLY_POLLY_ENGINE": ctx("pollyEngine") or "generative",
            "DOCUMENT_BUCKET": documents.bucket_name,
            "CALL_AUDIO_BUCKET": call_audio.bucket_name,
            "NOTIFICATION_DLQ_URL": notification_dlq.queue_url,
            "OPS_TOPIC_ARN": ops_topic.topic_arn,
            "ESCALATION_CONTACT_TIMEOUT": str(contact_timeout),
            "INVESTIGATION_WINDOW_MIN": investigation_window,
            "WAKE_GRACE_MIN": str(ctx("wakeGraceMin") or 15),
            "PUBLIC_WEB_URL": web_origins[-1],
            "CORS_ORIGINS": ",".join(web_origins),
        }

        def image(target: str, cmd: list[str] | None = None) -> lambda_.DockerImageCode:
            return lambda_.DockerImageCode.from_image_asset(
                ALLY_DIR, target=target, platform=platform, cmd=cmd, exclude=[".venv", "tests", ".env"]
            )

        escalation_fn = lambda_.DockerImageFunction(
            self,
            "EscalationStepFn",
            code=image("worker", ["lambda_escalation.handler"]),
            architecture=architecture,
            memory_size=1024,
            timeout=Duration.seconds(30),
            environment=common_env,
            tracing=lambda_.Tracing.ACTIVE,
            log_group=logs.LogGroup(self, "EscalationStepLogs", retention=logs.RetentionDays.TWO_WEEKS),
        )

        state_machine = sfn.StateMachine(
            self,
            "FamilyEscalation",
            state_machine_name="AllyFamilyEscalation",
            state_machine_type=sfn.StateMachineType.STANDARD,
            definition_body=sfn.DefinitionBody.from_string(
                json.dumps(definition(escalation_fn.function_arn, contact_timeout, contact_timeout))
            ),
            logs=sfn.LogOptions(
                destination=logs.LogGroup(self, "EscalationLogs", retention=logs.RetentionDays.TWO_WEEKS),
                level=sfn.LogLevel.ERROR,
            ),
            tracing_enabled=True,
            timeout=Duration.hours(2),
        )
        escalation_fn.grant_invoke(state_machine)

        runtime_env = {**common_env, "ALLY_STATE_MACHINE_ARN": state_machine.state_machine_arn}

        api_fn = lambda_.DockerImageFunction(
            self,
            "ApiFn",
            code=image("api"),
            architecture=architecture,
            memory_size=2048,
            timeout=Duration.seconds(29),
            environment=runtime_env,
            tracing=lambda_.Tracing.ACTIVE,
            log_group=logs.LogGroup(self, "ApiLogs", retention=logs.RetentionDays.TWO_WEEKS),
        )
        worker_fn = lambda_.DockerImageFunction(
            self,
            "WorkerFn",
            code=image("worker", ["lambda_worker.handler"]),
            architecture=architecture,
            memory_size=1024,
            timeout=Duration.seconds(60),
            reserved_concurrent_executions=int(worker_reserved) if worker_reserved else None,
            environment=runtime_env,
            tracing=lambda_.Tracing.ACTIVE,
            # The sweep runs every minute with no retries; a failed invocation goes here
            # instead of being lost between ticks.
            dead_letter_queue=worker_dlq,
            log_group=logs.LogGroup(self, "WorkerLogs", retention=logs.RetentionDays.TWO_WEEKS),
        )

        # ---- permissions --------------------------------------------------------------------
        # Both the primary and the failover region, and both the inference profile and the
        # foundation model the profile resolves to.
        bedrock = iam.PolicyStatement(
            actions=["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources=[
                f"arn:aws:bedrock:{self.region}:{self.account}:inference-profile/{model_id}",
                f"arn:aws:bedrock:{failover_region}:{self.account}:inference-profile/{model_id}",
                f"arn:aws:bedrock:*::foundation-model/{model_id.split('.', 1)[1]}",
            ],
        )
        # Transcribe streaming and Polly are account-level APIs with no resource ARNs to narrow to.
        voice = iam.PolicyStatement(
            actions=["polly:SynthesizeSpeech", "polly:DescribeVoices", "transcribe:StartStreamTranscription"],
            resources=["*"],
        )
        documents_ai = iam.PolicyStatement(
            actions=[
                "textract:AnalyzeDocument",
                "textract:StartDocumentAnalysis",
                "textract:GetDocumentAnalysis",
                "comprehendmedical:DetectEntitiesV2",
            ],
            resources=["*"],
        )
        # SMS to an arbitrary phone number has no topic ARN to scope to; the ops topic does.
        sms = iam.PolicyStatement(actions=["sns:Publish"], resources=["*"])
        runtime_secret = secretsmanager.Secret.from_secret_name_v2(self, "RuntimeSecret", SECRET_NAME)
        # SendTaskSuccess is authorised by the task token itself; the resource cannot be narrowed
        # without a dependency cycle between the function and the state machine.
        task_tokens = iam.PolicyStatement(actions=["states:SendTaskSuccess", "states:SendTaskFailure"], resources=["*"])
        executions = iam.PolicyStatement(
            actions=["states:StopExecution", "states:DescribeExecution"],
            resources=[f"arn:aws:states:{self.region}:{self.account}:execution:AllyFamilyEscalation:*"],
        )

        for fn in (api_fn, worker_fn, escalation_fn):
            table.grant_read_write_data(fn)
            for statement in (bedrock, task_tokens, sms):
                fn.add_to_role_policy(statement)
            runtime_secret.grant_read(fn)
            ops_topic.grant_publish(fn)
            notification_dlq.grant_send_messages(fn)

        api_fn.add_to_role_policy(voice)
        api_fn.add_to_role_policy(documents_ai)
        documents.grant_read_write(api_fn)
        call_audio.grant_read_write(api_fn)
        call_audio.grant_read_write(escalation_fn)
        escalation_fn.add_to_role_policy(voice)

        for fn in (api_fn, worker_fn):
            state_machine.grant_start_execution(fn)
            fn.add_to_role_policy(executions)

        # ---- api ----------------------------------------------------------------------------
        api_target: lambda_.IFunction = api_fn
        if provisioned > 0:
            api_target = lambda_.Alias(
                self,
                "ApiLive",
                alias_name="live",
                version=api_fn.current_version,
                provisioned_concurrent_executions=provisioned,
            )
        integration = integrations.HttpLambdaIntegration("ApiIntegration", api_target)
        jwt = authorizers.HttpJwtAuthorizer(
            "CognitoJwt",
            jwt_issuer=f"https://cognito-idp.{self.region}.amazonaws.com/{pool.user_pool_id}",
            jwt_audience=[client.user_pool_client_id],
        )
        http_api = apigw.HttpApi(
            self,
            "AllyHttpApi",
            api_name="ally",
            cors_preflight=apigw.CorsPreflightOptions(
                allow_origins=web_origins,
                allow_methods=[apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.DELETE],
                allow_headers=["authorization", "content-type"],
                max_age=Duration.hours(1),
            ),
        )
        public = apigw.HttpNoneAuthorizer()
        for path, method in (
            ("/health", apigw.HttpMethod.GET),
            ("/health/deep", apigw.HttpMethod.GET),
            ("/ally/push/vapid-public-key", apigw.HttpMethod.GET),
            ("/ally/watch", apigw.HttpMethod.POST),  # device key checked in the app
            ("/ally/escalations/reply", apigw.HttpMethod.POST),  # HMAC reply token checked in the app
        ):
            http_api.add_routes(path=path, methods=[method], integration=integration, authorizer=public)
        http_api.add_routes(
            path="/{proxy+}",
            methods=[apigw.HttpMethod.GET, apigw.HttpMethod.POST, apigw.HttpMethod.DELETE],
            integration=integration,
            authorizer=jwt,
        )
        stage = http_api.default_stage.node.default_child  # type: ignore[union-attr]
        # A throttle is the cheapest protection a demo API has: a runaway client is shed at the
        # edge instead of exhausting a 10-execution Lambda concurrency budget.
        stage.add_property_override(
            "DefaultRouteSettings", {"ThrottlingBurstLimit": 40, "ThrottlingRateLimit": 20}
        )

        # ---- schedule -----------------------------------------------------------------------
        events.Rule(
            self,
            "EveryMinuteSweep",
            schedule=events.Schedule.rate(Duration.minutes(1)),
            targets=[targets.LambdaFunction(worker_fn, retry_attempts=0)],
        )

        # ---- observability ------------------------------------------------------------------
        def ally_metric(name: str, statistic: str = "Sum") -> cw.Metric:
            return cw.Metric(
                namespace="Ally", metric_name=name, statistic=statistic, period=Duration.minutes(5)
            )

        llm_errors = ally_metric("LLMError")
        llm_failovers = ally_metric("LLMFailover")

        def alarm(
            construct_id: str,
            *,
            metric: cw.IMetric,
            threshold: float,
            description: str,
            evaluation_periods: int = 1,
        ) -> cw.Alarm:
            created = cw.Alarm(
                self,
                construct_id,
                metric=metric,
                threshold=threshold,
                evaluation_periods=evaluation_periods,
                treat_missing_data=cw.TreatMissingData.NOT_BREACHING,
                alarm_description=description,
            )
            created.add_alarm_action(cw_actions.SnsAction(ops_topic))
            return created

        alarm(
            "LlmErrorsAlarm",
            metric=llm_errors,
            threshold=1,
            description="Bedrock calls are failing in both regions; Ally shows an explicit error instead of replies.",
        )
        alarm(
            "LlmFailoverAlarm",
            metric=llm_failovers,
            threshold=3,
            description=f"Bedrock turns are repeatedly failing over to {failover_region}; the primary region is degraded.",
        )
        alarm(
            "ApiErrorsAlarm",
            metric=api_fn.metric_errors(period=Duration.minutes(5)),
            threshold=5,
            description="The API function is throwing; check the ApiLogs log group.",
        )
        alarm(
            "EscalationFailuresAlarm",
            metric=state_machine.metric_failed(period=Duration.minutes(5)),
            threshold=1,
            description="A family escalation did not complete. Someone may not have been contacted.",
        )
        alarm(
            "NotificationDlqAlarm",
            metric=notification_dlq.metric_approximate_number_of_messages_visible(),
            threshold=1,
            description="An alert could not be delivered and is sitting in the notification DLQ.",
        )
        alarm(
            "WorkerDlqAlarm",
            metric=worker_dlq.metric_approximate_number_of_messages_visible(),
            threshold=1,
            description="A one-minute sweep failed; reminders and wake windows may be late.",
        )

        dash = cw.Dashboard(self, "AllyDashboard", dashboard_name="Ally")
        dash.add_widgets(
            cw.GraphWidget(
                title="API latency (p90) & 5xx",
                left=[api_fn.metric_duration(statistic="p90")],
                right=[api_fn.metric_errors()],
            ),
            cw.GraphWidget(
                title="Bedrock latency (ms), errors & failovers",
                left=[ally_metric("LLMLatency", statistic="p90")],
                right=[llm_errors, llm_failovers],
            ),
            cw.GraphWidget(
                title="Family escalations",
                left=[state_machine.metric_started(), state_machine.metric_succeeded(), state_machine.metric_failed()],
            ),
            cw.GraphWidget(
                title="Undelivered work (DLQ depth)",
                left=[
                    notification_dlq.metric_approximate_number_of_messages_visible(),
                    worker_dlq.metric_approximate_number_of_messages_visible(),
                ],
            ),
        )

        CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        CfnOutput(self, "UserPoolId", value=pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=client.user_pool_client_id)
        CfnOutput(self, "StateMachineArn", value=state_machine.state_machine_arn)
        CfnOutput(self, "TableName", value=table.table_name)
        CfnOutput(self, "DocumentBucket", value=documents.bucket_name)
        CfnOutput(self, "CallAudioBucket", value=call_audio.bucket_name)
        CfnOutput(self, "OpsTopicArn", value=ops_topic.topic_arn)
        CfnOutput(self, "NotificationDlqUrl", value=notification_dlq.queue_url)
