import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as sd from '@aws-cdk/aws-servicediscovery';
import * as appmesh from '@aws-cdk/aws-appmesh';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

interface IManifest {
  Task: {
    Family: string;
    Cpu: number;
    Memory: number;
  };
  AppContainer: {
    Port: number;
    Image: string;
    HealthCheckPath: string;
    Command?: string[];
  };
  VirtualNode?: {
    Backends?: string[];
  }
}


export class CdkBuildServiceStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    let manifest: IManifest = yaml.load(fs.readFileSync('manifest.yaml', 'utf8')) as IManifest;

/*
    const yamlManifest = yaml.load(fs.readFileSync('manifest.yaml', 'utf8'));
    console.log(yamlManifest);
    var jsonString = JSON.stringify(yamlManifest);
    console.log(jsonString);
    var manifest =  JSON.parse(jsonString);
    if (manifest.Application.Image) { console.log(manifest.Application.Image); }


    if (manifest.Application.Image) { console.log(manifest.Application.Image); }
*/

    const environmentName : string = process.env.ENVIRONMENT_NAME || "";
    if (environmentName == "") {
      cdk.Annotations.of(scope).addError("Invalid Environment name");
    }
    const meshName : string = environmentName ;

    const vpcId : string = process.env.VPC_ID || "";
    if (vpcId == "") {
      cdk.Annotations.of(scope).addError("Invalid VPC id");
    }

    const clusterName : string = process.env.CLUSTER_NAME || "";
    if (clusterName == "") {
      cdk.Annotations.of(scope).addError("Invalid cluster name");
    }

    const serviceName : string = process.env.SERVICE_NAME || "";
    if (serviceName == "") {
      cdk.Annotations.of(scope).addError("Invalid service name");
    }

    const commitId = process.env.CONFIG_COMMIT_ID || "";
    if (commitId == "") {
      cdk.Annotations.of(scope).addError("Invalid Commit ID");
    }

    const envoyImage = process.env.ENVOY_IMAGE_URI || "";
    if (envoyImage == "") {
      cdk.Annotations.of(scope).addError("Invalid Envoy imsge URI");
    }

    const namespaceId = process.env.NAMESPACE_ID || "";
    if (namespaceId == "") {
      cdk.Annotations.of(scope).addError("Invalid namespace id");
    }

    const namespaceArn = process.env.NAMESPACE_ARN || "";
    if (namespaceArn == "") {
      cdk.Annotations.of(scope).addError("Invalid namespace Arn");
    }

    const namespaceName = process.env.NAMESPACE_NAME || "";
    if (namespaceName == "") {
      cdk.Annotations.of(scope).addError("Invalid namespace name");
    }

    const logGroupName = process.env.LOG_GROUP_NAME || "";
    if (logGroupName == "") {
      cdk.Annotations.of(scope).addError("Invalid Log Group name");
    }

    const subnetIdOne = process.env.VPC_SUBNET_ONE || "";
    if (subnetIdOne == "") {
      cdk.Annotations.of(scope).addError("Invalid subnet one");
    }

    const subnetIdTwo = process.env.VPC_SUBNET_TWO || "";
    if (subnetIdTwo == "") {
      cdk.Annotations.of(scope).addError("Invalid subnet two");
    }

    const securityGroupId = process.env.SECURITY_GROUP_ID || "";
    if (securityGroupId == "") {
      cdk.Annotations.of(scope).addError("Invalid security group");
    }

    const taskExecRoleArn = process.env.TASK_EXEC_ROLE_ARN || "";
    if (taskExecRoleArn == "") {
      cdk.Annotations.of(scope).addError("Invalid task exec role arn");
    }

    const taskRoleArn = process.env.TASK_ROLE_ARN || "";
    if (taskRoleArn == "") {
      cdk.Annotations.of(scope).addError("Invalid task role arn");
    }

    const ecsServiceName = serviceName + "-" + commitId;

    const appPort = manifest?.AppContainer?.Port ?? 80;

    // Create a virtual node

    console.log("Creating virtual node: vn-" + ecsServiceName );

    const mesh = appmesh.Mesh.fromMeshName(this, 'Mesh', meshName);
    const backends : string[] = manifest?.VirtualNode?.Backends ?? [];
    const backendVirtualServices : appmesh.IVirtualService[] = [];

    backends.forEach(element => {
      backendVirtualServices.push(
        appmesh.VirtualService.fromVirtualServiceAttributes(
          this, "vs-" + element, {
            mesh: mesh,
            virtualServiceName: element
          }
        )
      );
    });

    const virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
      mesh: mesh,
      virtualNodeName: "vn-" + ecsServiceName,
      listeners: [
          appmesh.VirtualNodeListener.http({
          port: appPort
        })
      ],
      serviceDiscovery: appmesh.ServiceDiscovery.dns(
        ecsServiceName + "." + environmentName + ".local"
      ),
      accessLog: appmesh.AccessLog.fromFilePath("/dev/stdout")
    });

    backendVirtualServices.forEach(element => {
      virtualNode.addBackend(
        appmesh.Backend.virtualService(element)
      );
    }); 

    // Create task definition

    const taskFamily = manifest.Task.Family;
    const taskCpu = manifest.Task.Cpu ?? 256;
    const taskMemory = manifest.Task.Memory ?? 512;

    const appImage = manifest.AppContainer.Image;
    const appCommand = manifest.AppContainer.Command;
    const appHealthCheckPath = manifest.AppContainer.HealthCheckPath;

    console.log("Creating task defn with family: " + taskFamily );

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: taskCpu,
      family: taskFamily,
      memoryLimitMiB: taskMemory,
      executionRole: iam.Role.fromRoleArn(this, "ExecutionRole", taskExecRoleArn),
      taskRole: iam.Role.fromRoleArn(this, "TaskRole", taskRoleArn),
      proxyConfiguration: new ecs.AppMeshProxyConfiguration({
        containerName: 'envoy',     
        properties: {
          appPorts: [appPort],
          proxyEgressPort: 15001,
          proxyIngressPort: 15000,
          ignoredUID: 1337,
          egressIgnoredIPs: [
            '169.254.170.2',
            '169.254.169.254'
          ]
        }
      })
    });

    // Add application container

    const logGroup = logs.LogGroup.fromLogGroupName(this, 'LogGroup', logGroupName);

    console.log("Adding app container");

    const appContainer = taskDefinition.addContainer("appContainer", {
      containerName: "app",
      image: ecs.ContainerImage.fromRegistry(appImage),
      stopTimeout: cdk.Duration.seconds(10),
      command: appCommand,
      essential: true,
      portMappings: [
        {
          containerPort: appPort,
          protocol: ecs.Protocol.TCP
        }
      ],
      healthCheck: {
        command: [
          "CMD-SHELL",
          "curl -f http://localhost:" + appPort + appHealthCheckPath + " || exit 1"
        ],
        retries: 3,
        timeout: cdk.Duration.seconds(2),
        interval: cdk.Duration.seconds(5),
        startPeriod: cdk.Duration.seconds(10)
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "app-" + ecsServiceName,
        logGroup: logGroup
      })
    });

    // Add envoy container

    console.log("Adding envoy container");

    const envoyContainer = taskDefinition.addContainer("envoyContainer", {
      containerName: "envoy",
      image: ecs.ContainerImage.fromRegistry(envoyImage),
      stopTimeout: cdk.Duration.seconds(10),
      essential: true,
      user: "1337",
      environment: {
        APPMESH_RESOURCE_ARN: virtualNode.virtualNodeArn
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "curl -s http://localhost:9901/server_info | grep state | grep -q LIVE"
        ],
        retries: 3,
        timeout: cdk.Duration.seconds(2),
        interval: cdk.Duration.seconds(5),
        startPeriod: cdk.Duration.seconds(10)
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "envoy-" + ecsServiceName,
        logGroup: logGroup
      })
    });

    // Add app container dependency on envoy container

    appContainer.addContainerDependencies({
      container: envoyContainer,
      condition: ecs.ContainerDependencyCondition.HEALTHY
    });


    // Create a service

    console.log("Importing external resources");

    console.log("Security group");
    const containerSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "SecurityGroup", securityGroupId);

    console.log("VPC");
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", {
      vpcId: vpcId
    });
    
    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName: clusterName,
      vpc: vpc,
      securityGroups: [ containerSecurityGroup ]
    });
    const namespace = sd.PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(this, "Namespace", {
      namespaceId: namespaceId,
      namespaceName: namespaceName,
      namespaceArn: namespaceArn
    });
    const subnetOne = ec2.Subnet.fromSubnetId(this, "SubnetOne", subnetIdOne);
    const subnetTwo = ec2.Subnet.fromSubnetId(this, "SubnetTwo", subnetIdTwo);

    // Service params

    const minCount = 2;
    const maxCount = 6;
    const targetUtilizationPercent = 80;

    console.log("Creating ECS service: " + ecsServiceName);

    const service = new ecs.FargateService(this, "Service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: ecsServiceName,
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        container: appContainer,
        dnsTtl: cdk.Duration.seconds(20),
        name: ecsServiceName
      },
      vpcSubnets: {
        subnets: [ subnetOne, subnetTwo ]
      },
      securityGroup: containerSecurityGroup
    });
    service
      .autoScaleTaskCount({
        minCapacity: minCount,
        maxCapacity: maxCount 
      })
      .scaleOnCpuUtilization("ScalingPolicy", {
        targetUtilizationPercent: targetUtilizationPercent
      });

  }
}