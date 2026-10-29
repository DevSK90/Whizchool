-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- The balance follows total, paid and status on every insert and update, whichever code path writes them.
CREATE FUNCTION "invoice_balance"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."balance" := CASE WHEN NEW."status" = 'void' THEN 0 ELSE NEW."total" - NEW."paid" END;
  RETURN NEW;
END
$$;

CREATE TRIGGER "invoice_balance" BEFORE INSERT OR UPDATE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION "invoice_balance"();

UPDATE "Invoice" SET "balance" = CASE WHEN "status" = 'void' THEN 0 ELSE "total" - "paid" END;
