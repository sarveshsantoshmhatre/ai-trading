import { getPortfolio } from "./getPortfolio";
import { PrismaClient } from "./generated/prisma/client";
const prisma = new PrismaClient();

setInterval(async () => {
    const models = await prisma.models.findMany();
    for (const model of models) {
        const portfolio = await getPortfolio({
            apiKey: "", // getPortfolio uses only accountIndex; do not load the trading secret here.
            modelName: model.openRoutermodelName,
            name: model.name,
            invocationCount: model.invocationCount,
            id: model.id,
            accountIndex: model.accountIndex,
        });
        await prisma.portfolioSize.create({
            data: {
                modelId: model.id,
                netPortfolio: portfolio.total,
            },
        });
    }
}, 1000 * 60 * 2);