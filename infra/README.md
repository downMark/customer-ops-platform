# Customer Ops Infrastructure

AWS resources are created and updated by CloudFormation. Application workflows
only publish code or images after the two platform stacks exist.

## Stack layout

- `customer-ops-<environment>-foundation`
  - VPC, two public subnets, security groups
  - ECR repositories and Lambda artifact bucket
  - ECS cluster for CPU Fargate services
  - task roles, log groups, Secrets Manager secrets
  - domain/operations SNS topics, quality/analytics queues and their DLQs
  - DynamoDB failure-drill state
- `customer-ops-<environment>-runtime`
  - backend Lambda, version aliases, API Gateway REST API and canary stage
  - Event Worker Lambda and SQS event source mappings
  - API health Synthetics Canary, alarms and operations Dashboard
  - private model-server NLB and CPU Fargate service
  - public model-api ALB and Fargate ECS service

The model-server uses 4 vCPU, 16 GiB memory, and 30 GiB ephemeral storage. It
downloads the merged, quantized GGUF from S3 at task startup and performs CPU
inference without CUDA.

The same task downloads `bge-m3-onnx` and `bge-reranker-v2-m3-onnx` from the
`models/customer-ops/` prefix, verifies each directory's `SHA256SUMS`, and
serves embedding/rerank through the existing private NLB. The task remains
4 vCPU and 16 GiB.

## GitHub Environments

Create one `production` GitHub Environment with:

Secrets:

- `DATABASE_URL`: Neon pooled PostgreSQL connection URL.
- `CLOUDFLARE_API_TOKEN`: account-scoped token with **Workers Scripts: Edit**
  and **Account Settings: Read** for the account in
  `CLOUDFLARE_ACCOUNT_ID`.

Variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `AWS_REGION`: optional; defaults to `ap-northeast-1`.
- `AWS_DEPLOY_ROLE_ARN`: optional; defaults to the repository's
  `gh-actions-deploy` role.
- `MODEL_BUCKET_NAME`: optional; defaults to `customer-ops-models`.
- `MODEL_OBJECT_KEY`: optional; defaults to the uploaded GGUF key.
- `EMBEDDING_MODEL_PREFIX`: optional; defaults to
  `models/customer-ops/bge-m3-onnx/`.
- `RERANK_MODEL_PREFIX`: optional; defaults to
  `models/customer-ops/bge-reranker-v2-m3-onnx/`.
- `FRONTEND_ORIGIN`: optional. It is not needed for the first deployment. Set
  it later to the Worker/custom-domain origin to tighten direct backend CORS.
## Infrastructure updates

Run **Infrastructure - Update Production** and enter `UPDATE`. This workflow is
update-only: it requires both stacks to exist, preserves the current Backend
code key and ECS image URIs, builds the Event Worker, and updates CloudFormation.
It does not deploy the frontend or roll ECS services.

The GitHub deployment role needs the existing CloudFormation/S3/IAM deployment
permissions plus Lambda Event Worker updates, API Gateway stage reads/writes,
Lambda alias reads/writes, `cloudwatch:DescribeAlarms`, and
`synthetics:GetCanaryRuns`.

## RAG rollout order

When introducing or changing the BGE models, deploy production in this order:

1. Commit and push the code.
2. Run **Infrastructure - Update Production** for `production` with confirmation
   `UPDATE`. This updates the task role and task-definition
   model paths while keeping model-server at 4 vCPU / 16 GiB.
3. Rerun **Python Model Server - Amazon ECS** if its push-triggered run was
   blocked before the infrastructure update completed.
4. Confirm ECS service stability, then rerun **Model API - Amazon ECS** if
   necessary.

The model-server workflow checks the ONNX artifacts and active task definition
before replacing the image. Missing RAG configuration fails the workflow
without starting an unsafe ECS rollout.

## Backend canary

API Gateway's normal stage variable targets Lambda alias `stable`. Its canary
override targets alias `canary`. A backend deployment publishes an immutable
Lambda version and updates `canary`, while keeping traffic at 0%.

Use **Backend - Canary Control** to inspect, set 0%/10%/25%/50%/100%, promote,
or roll back. Traffic increases are blocked unless alarms are OK and the latest
Synthetics run passed. Alarms never change traffic automatically.

To change the percentage in the AWS console:

1. Open **API Gateway** -> **REST APIs** ->
   `customer-ops-<environment>-backend`.
2. Open **Stages** -> `<environment>` -> **Canary**.
3. Change the canary traffic percentage, for example 10%, 25%, 50%, then 100%.
   Set it to 0% to roll back immediately.

At 100%, finish the promotion so the next release has a clean baseline:

1. In **Lambda** -> the backend function -> **Aliases**, note the version used
   by `canary`.
2. Edit `stable` to that same version.
3. Return to the API Gateway stage and set canary traffic to 0%.

Do not change the canary stage-variable override: it must remain
`lambdaAlias=canary`.

## Synthetics and DLQ operations

- CloudWatch → Synthetics Canaries → `cops-production-api` shows five-minute
  health runs and failure artifacts.
- CloudWatch → Dashboards → `customer-ops-production-operations` combines API,
  Lambda, SNS, SQS/DLQ, Canary and ECS metrics.
- The authenticated frontend `/operations` page shows sanitized live queue
  state. Only admins can trigger a controlled poison event or recover/redrive it.
