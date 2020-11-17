#!/usr/bin/env node
import 'source-map-support/register'
import { execSync } from 'child_process'
import { App, Aspects } from '@aws-cdk/core'
import { StackTags } from '@ndlib/ndlib-cdk'
import { ContentfulAlephStack } from '../lib/contentful-aleph-stack'

// The context values here are defaults only. Passing context in cli will override these
const username = execSync('id -un').toString().trim()
const app = new App({
  context: {
    owner: username,
    contact: `${username}@nd.edu`,
  },
})
Aspects.of(app).add(new StackTags())

const stage = app.node.tryGetContext('stage') || 'dev'
const sentryProject = app.node.tryGetContext('sentryProject')

let lambdaCodePath = app.node.tryGetContext('lambdaCodePath')
let sentryVersion = app.node.tryGetContext('sentryVersion')
if (!lambdaCodePath) {
  lambdaCodePath = '../contentful_aleph/src'
  sentryVersion = execSync(`cd ${lambdaCodePath} && git rev-parse HEAD`).toString().trim()
}

if (lambdaCodePath) {
  const stackName = app.node.tryGetContext('serviceStackName') || `contentful-aleph-${stage}`
  new ContentfulAlephStack(app, stackName, {
    stackName,
    stage,
    lambdaCodePath,
    sentryProject,
    sentryVersion,
  })
}
