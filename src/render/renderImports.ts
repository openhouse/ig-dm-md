export function renderImports(data: any): string {
  const lines = ['# Imports', '', '| Source | Kind | Modified | First imported | Warnings |', '| --- | --- | --- | --- | --- |'];
  for (const e of data.exports) lines.push(`| ${e.name} | ${e.source_kind} | ${e.modified_time ?? ''} | ${e.first_imported_at ?? e.imported_at ?? ''} | ${e.warning_count ?? 0} |`);
  return `${lines.join('\n')}\n`;
}
export function renderWarnings(data: any): string {
  const lines = ['# Parser warnings', '', 'No message bodies are included in this file.', ''];
  const warnings = dedupeWarnings(data.warnings);
  if (!warnings.length) lines.push('No warnings.');
  for (const w of warnings) lines.push(`- ${w.severity} ${w.code}: ${w.message} (source: ${w.source_name ?? 'unknown'}${w.source_path ? `, path: ${w.source_path}` : ''}${w.thread_title ? `, thread: ${w.thread_title}` : ''})`);
  return `${lines.join('\n')}\n`;
}

export function dedupeWarnings(warnings: any[]): any[] {
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const warning of warnings) {
    const key = JSON.stringify({
      source_export_id: warning.source_export_id ?? null,
      thread_id: warning.thread_id ?? null,
      message_id: warning.message_id ?? null,
      severity: warning.severity,
      code: warning.code,
      message: warning.message,
      source_path: warning.source_path ?? null
    });
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
}
