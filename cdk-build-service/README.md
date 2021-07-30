# Welcome to your CDK TypeScript project!

This is a blank project for TypeScript development with CDK.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template


## Notes

### Use of js-yaml

The CDK build-service-stack script reads a YAML service template using js-yaml.

The YAML is expected to be compliant with the `IManifest` interface.

Currently using type assertion but this is not recommended as it is only applied at compile time.

If loaded object does not comply, then the code will still run and probably fail later.
