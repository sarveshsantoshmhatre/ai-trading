-- CreateEnum
CREATE TYPE "ToolCallType" AS ENUM ('CREATE_POSITION', 'CLOSE_POSITION');

-- CreateTable
CREATE TABLE "Models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ligherMarketId" INTEGER NOT NULL,
    "modelName" TEXT NOT NULL,
    "lighterApiKey" TEXT NOT NULL,
    "invocationCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invocations" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCalls" (
    "id" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "toolCallType" "ToolCallType" NOT NULL,
    "metadata" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolCalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSize" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "netPortfolio" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioSize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Models_name_key" ON "Models"("name");

-- CreateIndex
CREATE INDEX "Models_name_idx" ON "Models"("name");

-- CreateIndex
CREATE INDEX "Invocations_modelId_idx" ON "Invocations"("modelId");

-- CreateIndex
CREATE INDEX "ToolCalls_invocationId_idx" ON "ToolCalls"("invocationId");

-- CreateIndex
CREATE INDEX "PortfolioSize_modelId_idx" ON "PortfolioSize"("modelId");

-- AddForeignKey
ALTER TABLE "Invocations" ADD CONSTRAINT "Invocations_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCalls" ADD CONSTRAINT "ToolCalls_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "Invocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSize" ADD CONSTRAINT "PortfolioSize_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
