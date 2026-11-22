-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "terms_accepted_ip" TEXT,
ADD COLUMN     "terms_version" TEXT;

