-- CreateTable
CREATE TABLE `Author` (
    `id` VARCHAR(191) NOT NULL,
    `githubUsername` VARCHAR(191) NOT NULL,
    `bio` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Showcase` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Material` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `details` VARCHAR(191) NOT NULL,
    `image` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Node` (
    `id` VARCHAR(191) NOT NULL,
    `latitude` VARCHAR(191) NOT NULL,
    `longitude` VARCHAR(191) NOT NULL,
    `showcaseId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShowcaseTag` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ShowcaseToShowcaseTag` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_ShowcaseToShowcaseTag_AB_unique`(`A`, `B`),
    INDEX `_ShowcaseToShowcaseTag_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_MaterialToShowcase` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_MaterialToShowcase_AB_unique`(`A`, `B`),
    INDEX `_MaterialToShowcase_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Showcase` ADD CONSTRAINT `Showcase_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `Author`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Node` ADD CONSTRAINT `Node_showcaseId_fkey` FOREIGN KEY (`showcaseId`) REFERENCES `Showcase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ShowcaseToShowcaseTag` ADD FOREIGN KEY (`A`) REFERENCES `Showcase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ShowcaseToShowcaseTag` ADD FOREIGN KEY (`B`) REFERENCES `ShowcaseTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MaterialToShowcase` ADD FOREIGN KEY (`A`) REFERENCES `Material`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MaterialToShowcase` ADD FOREIGN KEY (`B`) REFERENCES `Showcase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
