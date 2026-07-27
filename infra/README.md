# Customer Ops Infrastructure

AWS resources are created and updated by CloudFormation. Application workflows
only publish code or images after the two platform stacks exist.

## Stack layout

- `customer-ops-<environment>-foundation`
  - VPC, two public subnets, security groups
  - ECR repositories and Lambda artifact bucket
  - ECS cluster for CPU Fargate services
  - task roles, log groups, Secrets Manager secrets
  - SNS topic, quality/analytics queues and their DLQs
- `customer-ops-<environment>-runtime`
  - backend Lambda, version aliases, API Gateway REST API and canary stage
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
- `BACKEND_CANARY_PERCENT`: optional initial release percentage expressed as a
  fraction; defaults to `0.10` (10%).

## First deployment

Run **Infrastructure - Provision Platform**, select the GitHub Environment, and
enter `PROVISION`. The workflow:

1. validates both CloudFormation templates and all GGUF/BGE S3 model artifacts;
2. creates/updates the foundation stack;
3. builds and uploads the Lambda package and both ECS images;
4. creates/updates the runtime stack;
5. builds and creates/updates the Cloudflare Worker.

There is no frontend address before the first Worker deployment. After Wrangler
deploys it, the workflow summary shows `Frontend URL` from Wrangler's
`deployment-url` output. The Worker proxies both `/backend-api/*` and
`/model-api/*`, so the browser uses same-origin URLs and the first deployment
does not depend on `FRONTEND_ORIGIN`.

## RAG rollout order

When introducing or changing the BGE models, deploy production in this order:

1. Commit and push the code.
2. Run **Infrastructure - Provision Platform** for `production` with confirmation
   `PROVISION`. This updates the task role and task-definition
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
Lambda version and sends the configured percentage to `canary`.

The workflow starts at 10% (or `BACKEND_CANARY_PERCENT`) and makes no further
traffic changes. CloudWatch alarms remain available for operators, but they do
not automatically promote or roll back the release.

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
