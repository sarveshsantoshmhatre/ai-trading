import { PrismaClient } from "../generated/prisma/client";
import { encryptSecret, isEncryptedSecret } from "../credentialCrypto";

const prisma = new PrismaClient();

async function main() {
  // Validate the key before reading/updating any rows.
  encryptSecret("credential-migration-key-check");
  const models = await prisma.models.findMany({
    select: { id: true, name: true, lighterApiKey: true },
  });
  let migrated = 0;
  for (const model of models) {
    if (isEncryptedSecret(model.lighterApiKey)) continue;
    await prisma.models.update({
      where: { id: model.id },
      data: { lighterApiKey: encryptSecret(model.lighterApiKey) },
    });
    migrated++;
    console.log("Encrypted exchange credential for model " + model.name);
  }
  console.log("Credential migration complete. Newly encrypted records: " + migrated);
}

main()
  .catch((error) => {
    console.error("Credential migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
