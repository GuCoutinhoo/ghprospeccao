// One-time mechanical extraction: preserve existing presentation calculations.
import ts from 'typescript-ast';
import fs from 'node:fs';
const file = 'src/lib/store/db.ts';
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(n => ts.isClassDeclaration(n));
const keep = ['getLeads','getNichesSummary','getStatesSummary','getPipelineBoard','getDashboardStats','getActivities','getFreelancerPerformance','getAdminDashboardStats','getFreelancerById'];
const methods = cls.members.filter(n => keep.includes(n.name?.getText(ast))).map(n => n.getText(ast)).join('\n\n');
const types = ast.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === '../../types').getText(ast);
fs.writeFileSync('src/lib/store/projections.ts', `${types}\nimport { isLeadInWorkspace, matchesFreelancerId } from './ownership';\nimport { normalizeStr, matchesNicheSemantics } from '../search/relevance';\nexport class Projections {\n private deletedLeadIds = new Set<string>();\n constructor(private data: {leads: Lead[]; freelancers: Freelancer[]; activities: Activity[]; search_jobs: SearchJob[]}) {}\n${methods}\n}\n`);

// Await the new asynchronous repository at every API call site, using AST positions.
const appFile = 'src/server/app.ts';
const app = fs.readFileSync(appFile, 'utf8');
const tree = ts.createSourceFile(appFile, app, ts.ScriptTarget.Latest, true);
const edits = [];
const functions = new Set();
function walk(n) {
 if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(tree) === 'db' && !ts.isAwaitExpression(n.parent)) {
  edits.push([n.getStart(tree), '(await '], [n.end, ')']);
  let p = n.parent;
  while (p && !ts.isArrowFunction(p) && !ts.isFunctionDeclaration(p) && !ts.isFunctionExpression(p)) p = p.parent;
  if (p && !p.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) functions.add(p);
 }
 ts.forEachChild(n, walk);
}
walk(tree);
for (const n of functions) edits.push([n.getStart(tree), 'async ']);
let result = app;
for (const [pos, text] of edits.sort((a,b) => b[0]-a[0])) result = result.slice(0,pos) + text + result.slice(pos);
fs.writeFileSync(appFile, result);
