export function renderImports(data: any): string {
  const lines = ['# Imports', '', '| Source | Kind | Modified | Imported | Warnings |', '| --- | --- | --- | --- | --- |'];
  for (const e of data.exports) lines.push(`| ${e.name} | ${e.source_kind} | ${e.modified_time ?? ''} | ${e.imported_at ?? ''} | ${e.warning_count ?? 0} |`);
  return `${lines.join('\n')}\n`;
}
export function renderWarnings(data: any): string {
  const lines = ['# Parser warnings', '', 'No message bodies are included in this file.', ''];
  if (!data.warnings.length) lines.push('No warnings.');
  for (const w of data.warnings) lines.push(`- ${w.severity} ${w.code}: ${w.message} (source: ${w.source_name ?? 'unknown'}${w.source_path ? `, path: ${w.source_path}` : ''}${w.thread_title ? `, thread: ${w.thread_title}` : ''})`);
  return `${lines.join('\n')}\n`;
}
