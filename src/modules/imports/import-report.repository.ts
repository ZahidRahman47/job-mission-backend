// Import report queries, always scoped by userId.
import { ImportReportModel, type ImportReportRecord } from './import-report.model.ts';

export async function create(input: {
  userId: string;
  fileName: string | null;
  totals: { rows: number; created: number; skipped: number; failed: number };
  rowErrors: { row: number; column: string; message: string }[];
}): Promise<ImportReportRecord> {
  const [report] = await ImportReportModel.create([input]);
  if (!report) throw new Error('Import report insert returned nothing');
  return report.toObject<ImportReportRecord>();
}

export function findOwned(userId: string, id: string): Promise<ImportReportRecord | null> {
  return ImportReportModel.findOne({ _id: id, userId }).lean<ImportReportRecord>().exec();
}

export async function deleteAllForUser(userId: string): Promise<void> {
  await ImportReportModel.deleteMany({ userId }).exec();
}
