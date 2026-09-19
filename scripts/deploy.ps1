# Ally one-command deploy (Windows PowerShell). Prereqs: Docker Desktop running, AWS CLI credentials, CDK CLI.
#   .\scripts\deploy.ps1 -WebOrigin https://main.xxxxx.amplifyapp.com
param(
  [string]$WebOrigin = "https://suraksha.d2dqtm6sqego9a.amplifyapp.com",
  [string]$Region = "us-east-1",
  [string]$SeedPassword = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:PATH = "D:\Tools\npm-global;" + $env:PATH
$env:AWS_REGION = $Region
$env:CDK_DEFAULT_REGION = $Region
$env:CDK_DEFAULT_ACCOUNT = (aws sts get-caller-identity --query Account --output text)

Write-Host "== 1/5 tests"
Push-Location "$root\ally"
& .\.venv\Scripts\python.exe -m pytest -q
if ($LASTEXITCODE -ne 0) { throw "tests failed" }

Write-Host "== 2/5 secrets (AWS Secrets Manager: ally/runtime)"
& .\.venv\Scripts\python.exe scripts\put_secrets.py
Pop-Location

Write-Host "== 3/5 cdk deploy"
Push-Location "$root\infra"
cdk deploy AllyStack --require-approval never -c "webOrigins=http://localhost:3000,https://main.d2dqtm6sqego9a.amplifyapp.com,$WebOrigin" --outputs-file cdk-outputs.json
if ($LASTEXITCODE -ne 0) { throw "cdk deploy failed" }
$out = (Get-Content cdk-outputs.json -Raw | ConvertFrom-Json).AllyStack
Pop-Location

Write-Host "== 4/5 seed Amma + family"
Push-Location "$root\ally"
$env:ALLY_TABLE = $out.TableName
$env:COGNITO_USER_POOL_ID = $out.UserPoolId
if ($SeedPassword) {
  & .\.venv\Scripts\python.exe scripts\seed.py --cognito --password $SeedPassword
} else {
  & .\.venv\Scripts\python.exe scripts\seed.py
}
Pop-Location

Write-Host "== 5/5 frontend (Amplify app suraksha / d2dqtm6sqego9a, auto-builds on push to suraksha)"
$vapid = (aws secretsmanager get-secret-value --secret-id ally/runtime --query SecretString --output text | ConvertFrom-Json).vapid_public_key
Write-Host "NEXT_PUBLIC_ALLY_API_URL=$($out.ApiUrl)"
Write-Host "NEXT_PUBLIC_COGNITO_USER_POOL_ID=$($out.UserPoolId)"
Write-Host "NEXT_PUBLIC_COGNITO_CLIENT_ID=$($out.UserPoolClientId)"
Write-Host "NEXT_PUBLIC_VAPID_PUBLIC_KEY=$vapid"
Write-Host "Site: https://suraksha.d2dqtm6sqego9a.amplifyapp.com"
Write-Host "If any of these changed, update them with: aws amplify update-app --app-id d2dqtm6sqego9a --environment-variables ..."
