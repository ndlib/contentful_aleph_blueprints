import {
  RestApi,
  MethodLoggingLevel,
  LambdaIntegration,
} from '@aws-cdk/aws-apigateway'
import { Rule, Schedule } from '@aws-cdk/aws-events'
import { Function, Code, Runtime } from '@aws-cdk/aws-lambda'
import { RetentionDays } from '@aws-cdk/aws-logs'
import { StringParameter } from '@aws-cdk/aws-ssm'
import { Construct, Stack, StackProps, Duration, SecretValue, Fn } from '@aws-cdk/core'
import targets = require('@aws-cdk/aws-events-targets')

export interface IContentfulAlephStackProps extends StackProps {
  readonly stage: string
  readonly lambdaCodePath: string
  readonly sentryProject: string
  readonly sentryVersion: string
}

export class ContentfulAlephStack extends Stack {
  constructor(scope: Construct, id: string, props: IContentfulAlephStackProps) {
    super(scope, id, props)

    // LAMBDAS
    const contentfulSecrets = `/all/contentful/${props.stage}`
    const paramStorePath = `/all/contentful-aleph/${props.stage}`
    const env = {
      SENTRY_DSN: StringParameter.valueForStringParameter(this, `${paramStorePath}/sentry_dsn`),
      SENTRY_ENVIRONMENT: props.stage,
      SENTRY_RELEASE: `${props.sentryProject}@${props.sentryVersion}`,
      ALEPH_GATEWAY_URL: Fn.importValue(`aleph-gateway-${props.stage}-api-url`),
      CONTENTFUL_CMA_URL: StringParameter.valueForStringParameter(this, `${paramStorePath}/contentful_cma_url`),
      CONTENTFUL_MANAGEMENT_TOKEN: SecretValue.secretsManager(contentfulSecrets, { jsonField: `management_token` }).toString(),
    }

    const hookLambda = new Function(this, 'HookFunction', {
      functionName: `${props.stackName}-hook`,
      description: 'Hook to populate aleph data.',
      code: Code.fromAsset(props.lambdaCodePath),
      handler: 'hook.handler',
      runtime: Runtime.NODEJS_12_X,
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 128,
      timeout: Duration.seconds(30),
      environment: env,
    })

    const syncLambda = new Function(this, 'SyncFunction', {
      functionName: `${props.stackName}-sync`,
      description: 'Sync contentful with aleph.',
      code: Code.fromAsset(props.lambdaCodePath),
      handler: 'sync.handler',
      runtime: Runtime.NODEJS_12_X,
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 128,
      timeout: Duration.minutes(5),
      environment: env,
    })

    // Cron job for running sync lambda
    new Rule(this, 'SyncCronRule', {
      description: 'Triggers periodic resync of all contentful data.',
      schedule: Schedule.cron({ // Every day at 4:00AM
        hour: '4',
        minute: '0',
      }),
      targets: [
        new targets.LambdaFunction(syncLambda),
      ],
    })

    // API GATEWAY
    const api = new RestApi(this, 'ApiGateway', {
      restApiName: props.stackName,
      endpointExportName: `${props.stackName}-api-url`,
      deployOptions: {
        stageName: props.stage,
        metricsEnabled: true,
        loggingLevel: MethodLoggingLevel.ERROR,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowCredentials: false,
        statusCode: 200,
      },
    })
    api.addRequestValidator('RequestValidator', {
      validateRequestParameters: true,
    })
    const hookResource = api.root.addResource('hook')
    hookResource.addMethod('POST', new LambdaIntegration(hookLambda))

    // Output API url to ssm so we can import it in the QA project
    new StringParameter(this, 'ApiUrlParameter', {
      parameterName: `${paramStorePath}/api-url`,
      description: 'Path to root of the API gateway.',
      stringValue: api.url,
    })
  }
}
