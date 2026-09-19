"""Ally on AWS: HTTP API + Lambda (FastAPI) + DynamoDB + Cognito + Step Functions + Bedrock.

Secrets (VAPID keys, device key, HMAC secret, Sarvam key) are SSM SecureString parameters under
/ally, created by scripts/put_secrets.py before the first deploy (CloudFormation cannot create
SecureStrings).
"""

from __future__ import annotations

import json
from pathlib import Path

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigatewayv2 as apigw
from aws_cdk import aws_apigatewayv2_authorizers as authorizers
from aws_cdk import aws_apigatewayv2_integrations as integrations
from aws_cdk import aws_cloudwatch as cw
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_secretsmanager as secretsmanager
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
            "ALLY_SECRET_NAME": SECRET_NAME,
            "ALLY_STT_PROVIDER": ctx("sttProvider") or "sarvam",
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
            log_group=logs.LogGroup(self, "WorkerLogs", retention=logs.RetentionDays.TWO_WEEKS),
        )

        # ---- permissions --------------------------------------------------------------------
        bedrock = iam.PolicyStatement(
            actions=["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources=[
                f"arn:aws:bedrock:{self.region}:{self.account}:inference-profile/{model_id}",
                f"arn:aws:bedrock:*::foundation-model/{model_id.split('.', 1)[1]}",
            ],
        )
        voice = iam.PolicyStatement(actions=["polly:SynthesizeSpeech", "transcribe:StartStreamTranscription"], resources=["*"])
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
            for statement in (bedrock, task_tokens):
                fn.add_to_role_policy(statement)
            runtime_secret.grant_read(fn)
        api_fn.add_to_role_policy(voice)
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
        llm_errors = cw.Metric(namespace="Ally", metric_name="LLMError", statistic="Sum", period=Duration.minutes(5))
        cw.Alarm(
            self,
            "LlmErrorsAlarm",
            metric=llm_errors,
            threshold=1,
            evaluation_periods=1,
            treat_missing_data=cw.TreatMissingData.NOT_BREACHING,
            alarm_description="Bedrock calls are failing; Ally shows an explicit error instead of replies.",
        )
        dash = cw.Dashboard(self, "AllyDashboard", dashboard_name="Ally")
        dash.add_widgets(
            cw.GraphWidget(title="API latency (p90) & 5xx", left=[api_fn.metric_duration(statistic="p90")], right=[api_fn.metric_errors()]),
            cw.GraphWidget(
                title="Bedrock latency (ms) & errors",
                left=[cw.Metric(namespace="Ally", metric_name="LLMLatency", statistic="p90", period=Duration.minutes(5))],
                right=[llm_errors],
            ),
            cw.GraphWidget(
                title="Family escalations",
                left=[state_machine.metric_started(), state_machine.metric_succeeded(), state_machine.metric_failed()],
            ),
        )

        CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        CfnOutput(self, "UserPoolId", value=pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=client.user_pool_client_id)
        CfnOutput(self, "StateMachineArn", value=state_machine.state_machine_arn)
        CfnOutput(self, "TableName", value=table.table_name)
