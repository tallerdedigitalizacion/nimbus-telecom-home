#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FormsBackendStack } from "../lib/forms-backend-stack";

const app = new cdk.App();

const allowedOrigins = (app.node.tryGetContext("allowedOrigins") as string | undefined)
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? ["https://staging.nimbustelecom.cat"];

new FormsBackendStack(app, "NimbusTelecomFormsBackendStack", {
  allowedOrigins,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
