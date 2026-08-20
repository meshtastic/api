import Prisma from "@prisma/client";

const { PrismaClient } = Prisma;

export const prisma = new PrismaClient();
