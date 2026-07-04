import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

export interface FormsBackendStackProps extends cdk.StackProps {
  readonly allowedOrigins: string[];
}

export class FormsBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FormsBackendStackProps) {
    super(scope, id, props);

    const recaptchaSecret = new cdk.CfnParameter(this, "RecaptchaSecret", {
      type: "String",
      noEcho: true,
      description: "Secret key de Google reCAPTCHA v3 (sitekey 6Le240AtAAAAANz_-yCkJ5fyJqeB0ppxA6617-B1).",
    });

    const contactWebhookUrl = new cdk.CfnParameter(this, "ContactWebhookUrl", {
      type: "String",
      noEcho: true,
      description: "URL del webhook de Make.com para el formulario de contacto (608).",
    });

    const callMeWebhookUrl = new cdk.CfnParameter(this, "CallMeWebhookUrl", {
      type: "String",
      noEcho: true,
      description: "URL del webhook de Make.com para el formulario de llamada (644).",
    });

    const submitFormFn = new NodejsFunction(this, "SubmitFormFunction", {
      entry: path.join(__dirname, "..", "lambda", "submit-form.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      bundling: {
        externalModules: [],
      },
      environment: {
        RECAPTCHA_SECRET: recaptchaSecret.valueAsString,
        CONTACT_WEBHOOK_URL: contactWebhookUrl.valueAsString,
        CALLME_WEBHOOK_URL: callMeWebhookUrl.valueAsString,
      },
    });

    const httpApi = new HttpApi(this, "FormsHttpApi", {
      description: "Backend de formularios compartido por las webs de Nimbus Telecom (es/ca/en).",
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ["content-type"],
        maxAge: cdk.Duration.hours(1),
      },
    });

    httpApi.addRoutes({
      path: "/submit-form",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("SubmitFormIntegration", submitFormFn),
    });

    new cdk.CfnOutput(this, "FormsApiEndpoint", {
      value: `${httpApi.apiEndpoint}/submit-form`,
      description: "Endpoint al que los formularios deben hacer POST.",
    });
  }
}
