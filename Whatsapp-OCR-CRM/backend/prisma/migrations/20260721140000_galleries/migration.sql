CREATE TABLE IF NOT EXISTS "Gallery" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pdfS3Key" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gallery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GalleryImage" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GalleryImage_galleryId_idx" ON "GalleryImage"("galleryId");

DO $$ BEGIN
    ALTER TABLE "GalleryImage" ADD CONSTRAINT "GalleryImage_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
