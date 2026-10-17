/*
  Warnings:

  - Added the required column `accountIndex` to the `Models` table without a default value. This is not possible if the table is not empty.
  - Added the required column `openRoutermodelName` to the `Models` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Models" ADD COLUMN     "accountIndex" TEXT NOT NULL,
ADD COLUMN     "openRoutermodelName" TEXT NOT NULL;
