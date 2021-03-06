import test, { Test } from "tape-promise/tape";
import { v4 as internalIpV4 } from "internal-ip";

import { CordaTestLedger } from "@hyperledger/cactus-test-tooling";
import { LogLevelDesc } from "@hyperledger/cactus-common";
import {
  SampleCordappEnum,
  CordaConnectorContainer,
} from "@hyperledger/cactus-test-tooling";

import {
  DefaultApi as CordaApi,
  FlowInvocationType,
  InvokeContractV1Request,
  JvmTypeKind,
} from "../../../main/typescript/generated/openapi/typescript-axios/index";

const logLevel: LogLevelDesc = "TRACE";

test("Tests are passing on the JVM side", async (t: Test) => {
  const ledger = new CordaTestLedger({
    imageName: "petermetz/cactus-corda-4-6-all-in-one-obligation",
    imageVersion: "2021-03-04-ac0d32a",
    logLevel,
  });
  t.ok(ledger, "CordaTestLedger instantaited OK");

  test.onFinish(async () => {
    try {
      const logBuffer = ((await ledgerContainer.logs({
        follow: false,
        stdout: true,
        stderr: true,
      })) as unknown) as Buffer;
      const logs = logBuffer.toString("utf-8");
      t.comment(`[CordaAllInOne] ${logs}`);
    } finally {
      try {
        await ledger.stop();
      } finally {
        await ledger.destroy();
      }
    }
  });
  const ledgerContainer = await ledger.start();
  t.ok(ledgerContainer, "CordaTestLedger container truthy post-start() OK");

  await ledger.logDebugPorts();
  const partyARpcPort = await ledger.getRpcAPublicPort();

  const jarFiles = await ledger.pullCordappJars(
    SampleCordappEnum.ADVANCED_OBLIGATION,
  );
  t.comment(`Fetched ${jarFiles.length} cordapp jars OK`);

  const internalIp = await internalIpV4();
  t.comment(`Internal IP (based on default gateway): ${internalIp}`);
  const springAppConfig = {
    cactus: {
      corda: {
        node: { host: internalIp },
        // TODO: parse the gradle build files to extract the credentials?
        rpc: { port: partyARpcPort, username: "user1", password: "password" },
      },
    },
  };
  const springApplicationJson = JSON.stringify(springAppConfig);
  const envVarSpringAppJson = `SPRING_APPLICATION_JSON=${springApplicationJson}`;
  t.comment(envVarSpringAppJson);

  const connector = new CordaConnectorContainer({
    logLevel,
    imageName: "petermetz/cactus-connector-corda-server",
    imageVersion: "2021-03-10-feat-624",
    envVars: [envVarSpringAppJson],
  });
  t.ok(CordaConnectorContainer, "CordaConnectorContainer instantaited OK");

  test.onFinish(async () => {
    try {
      const logBuffer = ((await connectorContainer.logs({
        follow: false,
        stdout: true,
        stderr: true,
      })) as unknown) as Buffer;
      const logs = logBuffer.toString("utf-8");
      t.comment(`[CordaConnectorServer] ${logs}`);
    } finally {
      try {
        await connector.stop();
      } finally {
        await connector.destroy();
      }
    }
  });

  // FIXME health checks with JMX appear to be working but this wait still seems
  // to be necessary in order to make it work on the CI server (locally it
  // works just fine without this as well...)
  await new Promise((r) => setTimeout(r, 120000));
  const connectorContainer = await connector.start();
  t.ok(connectorContainer, "CordaConnectorContainer started OK");

  await connector.logDebugPorts();
  const apiUrl = await connector.getApiLocalhostUrl();
  const apiClient = new CordaApi({ basePath: apiUrl });

  const flowsRes = await apiClient.listFlowsV1();
  t.ok(flowsRes.status === 200, "flowsRes.status === 200 OK");
  t.ok(flowsRes.data, "flowsRes.data truthy OK");
  t.ok(flowsRes.data.flowNames, "flowsRes.data.flowNames truthy OK");
  t.comment(`apiClient.listFlowsV1() => ${JSON.stringify(flowsRes.data)}`);

  const depRes = await apiClient.deployContractJarsV1({ jarFiles });
  t.ok(depRes, "Jar deployment response truthy OK");
  t.equal(depRes.status, 200, "Jar deployment status code === 200 OK");
  t.ok(depRes.data, "Jar deployment response body truthy OK");
  t.ok(depRes.data.deployedJarFiles, "Jar deployment body deployedJarFiles OK");
  t.equal(
    depRes.data.deployedJarFiles.length,
    jarFiles.length,
    "Deployed jar file count equals count in request OK",
  );

  const networkMapRes = await apiClient.networkMapV1();
  const partyA = networkMapRes.data.find((it) =>
    it.legalIdentities.some((it2) => it2.name.organisation === "ParticipantA"),
  );
  const partyAPublicKey = partyA?.legalIdentities[0].owningKey;

  const partyB = networkMapRes.data.find((it) =>
    it.legalIdentities.some((it2) => it2.name.organisation === "ParticipantB"),
  );
  const partyBPublicKey = partyB?.legalIdentities[0].owningKey;

  const req: InvokeContractV1Request = ({
    flowFullClassName: "net.corda.samples.obligation.flows.IOUIssueFlow",
    flowInvocationType: FlowInvocationType.TRACKEDFLOWDYNAMIC,
    params: [
      {
        jvmTypeKind: JvmTypeKind.REFERENCE,
        jvmType: {
          fqClassName: "net.corda.samples.obligation.states.IOUState",
        },

        jvmCtorArgs: [
          {
            jvmTypeKind: JvmTypeKind.REFERENCE,
            jvmType: {
              fqClassName: "net.corda.core.contracts.Amount",
            },

            jvmCtorArgs: [
              {
                jvmTypeKind: JvmTypeKind.PRIMITIVE,
                jvmType: {
                  fqClassName: "long",
                },
                primitiveValue: 42,
              },
              {
                jvmTypeKind: JvmTypeKind.REFERENCE,
                jvmType: {
                  fqClassName: "java.util.Currency",
                },

                jvmCtorArgs: [
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "USD",
                  },
                ],
              },
            ],
          },
          {
            jvmTypeKind: JvmTypeKind.REFERENCE,
            jvmType: {
              fqClassName: "net.corda.core.identity.Party",
            },

            jvmCtorArgs: [
              {
                jvmTypeKind: JvmTypeKind.REFERENCE,
                jvmType: {
                  fqClassName: "net.corda.core.identity.CordaX500Name",
                },

                jvmCtorArgs: [
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "ParticipantA",
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "London",
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "GB",
                  },
                ],
              },
              {
                jvmTypeKind: JvmTypeKind.REFERENCE,
                jvmType: {
                  fqClassName:
                    "org.hyperledger.cactus.plugin.ledger.connector.corda.server.impl.PublicKeyImpl",
                },

                jvmCtorArgs: [
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: partyAPublicKey?.algorithm,
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: partyAPublicKey?.format,
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: partyAPublicKey?.encoded,
                  },
                ],
              },
            ],
          },
          {
            jvmTypeKind: JvmTypeKind.REFERENCE,
            jvmType: {
              fqClassName: "net.corda.core.identity.Party",
            },

            jvmCtorArgs: [
              {
                jvmTypeKind: JvmTypeKind.REFERENCE,
                jvmType: {
                  fqClassName: "net.corda.core.identity.CordaX500Name",
                },

                jvmCtorArgs: [
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "ParticipantB",
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "New York",
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "US",
                  },
                ],
              },
              {
                jvmTypeKind: JvmTypeKind.REFERENCE,
                jvmType: {
                  fqClassName:
                    "org.hyperledger.cactus.plugin.ledger.connector.corda.server.impl.PublicKeyImpl",
                },

                jvmCtorArgs: [
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: partyBPublicKey?.algorithm,
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: partyBPublicKey?.format,
                  },
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: partyBPublicKey?.encoded,
                  },
                ],
              },
            ],
          },
          {
            jvmTypeKind: JvmTypeKind.REFERENCE,
            jvmType: {
              fqClassName: "net.corda.core.contracts.Amount",
            },

            jvmCtorArgs: [
              {
                jvmTypeKind: JvmTypeKind.PRIMITIVE,
                jvmType: {
                  fqClassName: "long",
                },
                primitiveValue: 1,
              },
              {
                jvmTypeKind: JvmTypeKind.REFERENCE,
                jvmType: {
                  fqClassName: "java.util.Currency",
                },

                jvmCtorArgs: [
                  {
                    jvmTypeKind: JvmTypeKind.PRIMITIVE,
                    jvmType: {
                      fqClassName: "java.lang.String",
                    },
                    primitiveValue: "USD",
                  },
                ],
              },
            ],
          },
          {
            jvmTypeKind: JvmTypeKind.REFERENCE,
            jvmType: {
              fqClassName: "net.corda.core.contracts.UniqueIdentifier",
            },

            jvmCtorArgs: [
              {
                jvmTypeKind: JvmTypeKind.PRIMITIVE,
                jvmType: {
                  fqClassName: "java.lang.String",
                },
                primitiveValue: "7fc2161e-f8d0-4c86-a596-08326bdafd56",
              },
            ],
          },
        ],
      },
    ],
    timeoutMs: 60000,
  } as unknown) as InvokeContractV1Request;

  const res = await apiClient.invokeContractV1(req);
  t.ok(res, "InvokeContractV1Request truthy OK");
  t.equal(res.status, 200, "InvokeContractV1Request status code === 200 OK");

  // const gradleProcess = spawn("./gradlew", ["test", "--stacktrace"], {
  //   shell: true,
  //   detached: true,
  //   cwd:
  //     "/home/peter/a/blockchain/cactus-origin/packages/cactus-plugin-ledger-connector-corda/src/main-server/kotlin/gen/kotlin-spring/",
  //   env: {
  //     SPRING_APPLICATION_JSON: springApplicationJson,
  //   },
  // });

  // const output: string[] = [];
  // gradleProcess.stdout.on("data", (data: Buffer) => {
  //   const line = data.toString("utf-8");
  //   t.comment(`[Gradle] stdout: ${line}`);
  //   output.push(line);
  // });

  // gradleProcess.stderr.on("data", (data: Buffer) => {
  //   const line = data.toString("utf-8");
  //   t.comment(`[Gradle] stderr: ${line}`);
  //   output.push(line);
  // });

  // const exitCode = await new Promise((resolve, reject) => {
  //   const fiveMinMs = 5 * 60 * 1000;
  //   const timeoutError = new Error("JVM Gradle tests timed out");
  //   const timer = setTimeout(() => reject(timeoutError), fiveMinMs);
  //   gradleProcess.once("close", (code) => {
  //     clearInterval(timer);
  //     t.comment(`[Gradle] child process exited with code ${code}`);
  //     resolve(code);
  //   });
  // });
  // t.strictEquals(exitCode, 0, "JVM Gradle exit code === 0 OK");

  // const jvmTestOk = output.some((it) => it.includes("BUILD SUCCESSFUL in"));
  // t.true(jvmTestOk, "JVM gradle tests appear to be successfuly OK");

  t.end();
});
