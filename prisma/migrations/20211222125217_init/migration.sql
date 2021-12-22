-- CreateTable
CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "githubUsername" TEXT NOT NULL,
    "bio" TEXT NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Showcase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "Showcase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "latitude" TEXT NOT NULL,
    "longitude" TEXT NOT NULL,
    "showcaseId" TEXT NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowcaseTag" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "ShowcaseTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ShowcaseToShowcaseTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_MaterialToShowcase" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ShowcaseToShowcaseTag_AB_unique" ON "_ShowcaseToShowcaseTag"("A", "B");

-- CreateIndex
CREATE INDEX "_ShowcaseToShowcaseTag_B_index" ON "_ShowcaseToShowcaseTag"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_MaterialToShowcase_AB_unique" ON "_MaterialToShowcase"("A", "B");

-- CreateIndex
CREATE INDEX "_MaterialToShowcase_B_index" ON "_MaterialToShowcase"("B");

-- AddForeignKey
ALTER TABLE "Showcase" ADD CONSTRAINT "Showcase_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "Showcase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShowcaseToShowcaseTag" ADD FOREIGN KEY ("A") REFERENCES "Showcase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ShowcaseToShowcaseTag" ADD FOREIGN KEY ("B") REFERENCES "ShowcaseTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaterialToShowcase" ADD FOREIGN KEY ("A") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaterialToShowcase" ADD FOREIGN KEY ("B") REFERENCES "Showcase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
