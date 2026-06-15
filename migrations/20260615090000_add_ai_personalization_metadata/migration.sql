ALTER TABLE "Communication" ADD COLUMN "personalizationSource" TEXT NOT NULL DEFAULT 'template';
ALTER TABLE "Communication" ADD COLUMN "personalizationReason" TEXT;
