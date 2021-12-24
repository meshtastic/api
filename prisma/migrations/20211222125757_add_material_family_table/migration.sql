/*
  Warnings:

  - Added the required column `familyId` to the `Material` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "familyId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "MaterialFamily" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "MaterialFamily_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "MaterialFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
