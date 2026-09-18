# Shared layers, two targets:
#   api    — FastAPI under uvicorn, fronted by the Lambda Web Adapter extension
#   worker — plain Lambda handlers (sweep + Step Functions steps) via awslambdaric
FROM public.ecr.aws/docker/library/python:3.12-slim AS base
WORKDIR /var/task
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt awslambdaric
COPY . .

FROM base AS api
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8080 AWS_LWA_READINESS_CHECK_PATH=/health
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]

FROM base AS worker
ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["lambda_worker.handler"]
