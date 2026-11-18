import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const commandCenter = fs.readFileSync('src/components/modules/CommandCenter.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const commandCenterCalls = [...app.matchAll(/<CommandCenter\b[\s\S]*?\/>/g)].map((m) => m[0]);
assert.equal(commandCenterCalls.length, 2, 'Both CommandCenter render paths must remain wired.');
for (const [index, call] of commandCenterCalls.entries()) {
  assert.match(call, /goal=\{quickGoal\}/, `CommandCenter call ${index + 1} must receive the shared goal.`);
  assert.match(call, /onGoalChange=\{setQuickGoal\}/, `CommandCenter call ${index + 1} must update the shared goal.`);
  assert.match(call, /onRunTask=\{handleRunQuickAgent\}/, `CommandCenter call ${index + 1} must dispatch the task.`);
}
assert.match(commandCenter, /value=\{goal\}/, 'Command input must be controlled by the shared goal.');
assert.match(commandCenter, /fileInputRef\.current\?\.click\(\)/, 'Attachment control must open the native file picker from the click event.');
assert.match(commandCenter, /MAX_ATTACHMENT_BYTES = 200 \* 1024/, 'Attachments must enforce the 200 KB limit.');
assert.match(commandCenter, /MAX_GOAL_CHARS = 250000/, 'Task payload must respect the API goal limit.');
assert.match(app, /mode: 'action_driven'/, 'Dispatch must select the action-driven execution path.');
assert.match(app, /\[BLOCKED\]/, 'Blocked final results must not be displayed as delivered.');
assert.match(server, /\['action_driven', 'unified', 'autonomous', 'hybrid'\]/, 'Backend must route action-driven requests to the action engine.');
assert.match(server, /type: 'final_result'/, 'Backend must return a structured final result.');

console.log('Command Center dispatch integration: 12 assertions passed.');
