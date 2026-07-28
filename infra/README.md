# Customer Ops Infrastructure

AWS resources are created and updated by CloudFormation. Application workflows
only publish code or images after the two platform stacks exist.

## Stack layout

- `customer-ops-<environment>-foundation`
  - VPC, two public subnets, security groups
  - ECR repositories and Lambda artifact bucket
  - ECS cluster, Fargate capacity and a scale-from-zero GPU capacity provider
  - `g4dn.xlarge` GPU Auto Scaling Group using the ECS GPU-optimized AL2023 AMI
  - task roles, log groups, Secrets Manager secrets
  - domain/operations SNS topics, quality/analytics queues and their DLQs
  - DynamoDB failure-drill state
- `customer-ops-<environment>-runtime`
  - backend Lambda, version aliases, API Gateway REST API and canary stage
  - Event Worker Lambda and SQS event source mappings
  - API health Synthetics Canary, alarms and operations Dashboard
  - private model-server NLB and GPU EC2 ECS service
  - public model-api ALB and Fargate ECS service

The production model-server runs one `g4dn.xlarge` (4 vCPU, 16 GiB RAM,
NVIDIA T4 16 GiB) through an ECS capacity provider. The task reserves one GPU
and offloads all supported Qwen layers through CUDA. The instance and model
endpoint remain private; the instance has outbound internet access only so it
can pull ECR images and S3 models without adding a NAT Gateway.

The same task downloads `bge-m3-onnx` and `bge-reranker-v2-m3-onnx` from the
`models/customer-ops/` prefix, verifies each directory's `SHA256SUMS`, and
serves embedding/rerank through the existing private NLB. ONNX inference
continues on CPU, while the shared inference gate prevents it from overlapping
with peak GGUF generation work.

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

Run **Infrastructure - Update Production**, enter `UPDATE`, and select
`GPU_EC2` (normal production) or `FARGATE` (rollback only). The workflow
requires both stacks to exist, reads the images from the currently active ECS
task definitions, builds the Event Worker, and updates CloudFormation. It does
not deploy the frontend or publish new application images. Changing the compute
choice intentionally replaces the model-server ECS Service with a distinct
name. This keeps the launch type, network mode and target-group transition
atomic instead of relying on an in-place capacity-provider conversion.

The GitHub deployment role needs the existing CloudFormation/S3/IAM deployment
permissions plus Lambda Event Worker updates, API Gateway stage reads/writes,
Lambda alias reads/writes, `cloudwatch:DescribeAlarms`, and the Synthetics
canary lifecycle actions (`CreateCanary`, `GetCanary`, `GetCanaryRuns`,
`UpdateCanary`, `DeleteCanary`, `StartCanary`, `StopCanary`, `TagResource`,
`UntagResource`, and `ListTagsForResource`). GPU preflight additionally needs
`servicequotas:GetServiceQuota` and `ec2:DescribeInstanceTypeOfferings`.

## GPU model-server rollout and rollback

Before the first migration, open **Service Quotas → Amazon Elastic Compute
Cloud (Amazon EC2) → Running On-Demand G and VT instances** in
`ap-northeast-1` and request at least **4 vCPUs**. New accounts commonly have a
zero quota. The Infrastructure workflow checks this before changing either
stack and stops with no infrastructure mutation when the quota is insufficient.

First GPU migration:

1. Commit and push the code.
2. Run **Infrastructure - Update Production** with confirmation `UPDATE` and
   compute `GPU_EC2`. It preserves the active CPU image, starts one GPU
   container instance, and places the existing model-server task there.
3. Wait until the model-server ECS service is healthy.
4. Run **Python Model Server - Amazon ECS** with `image_variant=gpu`.
5. Confirm `/health`, a short chat request, GPU utilization and first-token
   latency. Model API and frontend do not need redeployment for this migration.

Safe Fargate rollback:

1. While the service is still on GPU EC2, run **Python Model Server - Amazon
   ECS** with `image_variant=cpu` and wait for stability.
2. Run **Infrastructure - Update Production** with `model_server_compute=FARGATE`.
3. Confirm the Fargate task is healthy. The capacity provider then scales the
   GPU Auto Scaling Group back to zero.

Never switch a CUDA image directly to Fargate: the Fargate host does not expose
the NVIDIA driver required by the GPU build.

The model-server workflow checks the ONNX artifacts and active task definition
before replacing the image. Missing RAG configuration fails the workflow
without starting an unsafe ECS rollout.

At the current Tokyo on-demand price used for planning, one continuously
running `g4dn.xlarge` is about `$0.71/hour`, `$17.04/day`, or `$51.12` for
three full days and `$68.16` for four full days, before small EBS, log and
data-transfer charges. The instance exists only while the GPU ECS service
desires capacity; selecting the Fargate rollback causes the managed capacity
provider to return the ASG to zero.

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
