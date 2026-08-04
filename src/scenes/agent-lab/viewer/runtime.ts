export function simulationViewerRuntime() {
	function boot() {
		const root = document.querySelector<HTMLElement>('#simulation-root');
		const dataNode = document.querySelector<HTMLScriptElement>('#agent-lab-data');
		if (!root || !dataNode) return;
		let data = JSON.parse(dataNode.textContent || '{}');
		let revision = Number(document.documentElement.dataset.revision || 0);
		let connection = location.protocol.startsWith('http') ? 'connecting' : 'offline replay';
		let selectedDay = data.workdays?.find((day: any) => day.status === 'running')?.id || data.workdays?.[0]?.id || '';
		let ganttRangeMs: number | null = null;
		let ganttOffsetMs = 0;
		let showWorkdayTicks = false;
		let lastTrigger: HTMLElement | null = null;
		let openAssignmentId: string | null = null;
		let dialogKind: string | null = null;
		let restoreDialogTrigger = true;
		let currentPage = 'monitor';
		let metricKey = '';
		const filters: Record<string, { query: string; status: string; profile: string }> = {};
		const profileColor: Record<string, string> = { planning: 'var(--planning)', estimating: 'var(--estimating)', reviewing: 'var(--reviewing)', acting: 'var(--acting)', reporting: 'var(--reporting)', fallback: 'var(--unknown)' };
		const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		const text = (value: unknown) => typeof value === 'string' ? value : '';
		const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
		const fmt = (value: unknown) => {
			if (!value) return '—';
			try { return new Intl.DateTimeFormat('en-US', { timeZone: data.timeZone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(typeof value === 'number' ? value : String(value))); } catch { return String(value); }
		};
		const duration = (start: unknown, end: unknown) => {
			const ms = Math.max(0, new Date(String(end || Date.now())).getTime() - new Date(String(start || Date.now())).getTime());
			return ms < 60_000 ? Math.round(ms / 1_000) + 's' : Math.round(ms / 60_000) + 'm';
		};
		const hashColor = (id: string) => {
			let hash = 2166136261;
			for (const character of id) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
			return 'hsl(' + (hash >>> 0) % 360 + ' 82% 72%)';
		};
		const structured = (value: any, depth = 0): string => {
			if (value === null || value === undefined || value === '') return '<span class="meta">—</span>';
			if (typeof value === 'string') return value.length > 180 || value.includes('\n') ? '<div class="long">' + esc(value) + '</div>' : esc(value);
			if (typeof value !== 'object') return esc(value);
			if (Array.isArray(value)) return value.length ? '<ul>' + value.map((entry) => '<li>' + structured(entry, depth + 1) + '</li>').join('') + '</ul>' : '<span class="meta">None</span>';
			const entries = Object.entries(value).filter(([key]) => !/(^id$|Id$|Ids$|_id$|_ids$|Ref$|_ref$|digest$|cursor$)/.test(key));
			if (!entries.length) return '<span class="meta">None</span>';
			const body = '<dl class="structured">' + entries.map(([key, entry]) => '<dt>' + esc(key.replace(/([A-Z_])/g, ' $1')) + '</dt><dd>' + structured(entry, depth + 1) + '</dd>').join('') + '</dl>';
			return depth > 1 ? '<details><summary>' + entries.length + ' fields</summary>' + body + '</details>' : body;
		};
		const agentName = (id: unknown) => (data.agents || []).find((entry: any) => entry.id === id)?.title || text(id) || 'Unclaimed agent';
		const executions = () => (data.workdays || []).flatMap((day: any) => (day.executions || []).map((execution: any) => ({ ...execution, workdayId: day.id })));
		const providerAttempts = (dayOnly?: any) => (dayOnly ? [dayOnly] : data.workdays || []).flatMap((day: any) => {
			const assignments = day.executions || [], attempts = day.providerExecutions || [];
			if (!attempts.length) return assignments.map((entry: any) => ({ ...entry, workdayId: day.id }));
			return attempts.map((attempt: any) => {
				const assignmentId = attempt.assignmentId || attempt.assignment_id || attempt.providerAssignmentId || attempt.provider_assignment_id;
				const base = assignments.find((entry: any) => entry.assignmentId === assignmentId) || {};
				return { ...base, ...attempt, assignmentId, workdayId: day.id, startedAt: attempt.startedAt || attempt.started_at || attempt.createdAt || attempt.created_at, finishedAt: attempt.finishedAt || attempt.finished_at || attempt.completedAt || attempt.completed_at };
			});
		});
		const assignments = () => {
			const found = new Map<string, any>();
			for (const day of data.workdays || []) for (const assignment of day.assignments || []) found.set(String(assignment.id), { ...assignment, workdayId: day.id });
			for (const execution of executions()) if (execution.assignmentId && !found.has(execution.assignmentId)) found.set(execution.assignmentId, { ...execution.assignment, id: execution.assignmentId, workdayId: execution.workdayId });
			return [...found.values()];
		};
		const artifacts = () => {
			const found = new Map<string, any>();
			for (const execution of executions()) for (const artifact of execution.artifacts || []) {
				const key = String(artifact.uri || artifact.id || artifact.name || JSON.stringify(artifact));
				found.set(key, { ...artifact, assignmentId: execution.assignmentId, workdayId: execution.workdayId, agentId: execution.agentId });
			}
			return [...found.values()];
		};
		const eventCategory = (event: any) => {
			const type = String(event.eventType || '').toLowerCase();
			if (/settle|ledger|usage|reservation|credit|overrun/.test(type)) return 'Accounting';
			if (/treedx|content|artifact|workspace/.test(type)) return 'TreeDX / content';
			if (/recover|retry|expired|failure|error/.test(type)) return 'Recovery';
			if (/execution-provider|provider\.execution|codex/.test(type)) return 'Execution provider';
			if (/provider|runner/.test(type)) return 'Provider / runner';
			if (/lease|assignment|admission/.test(type)) return 'Assignment / lease';
			if (/execution|mode|tool|message|reasoning|context/.test(type)) return 'Agent runtime';
			if (/decision|proposal|approval|govern/.test(type)) return 'Governance';
			if (/schedule|demand|queue|tick/.test(type)) return 'Scheduling';
			return 'Workday';
		};
		const isWorkdayTick = (event: any) => /(^|[._-])tick($|[._-])/.test(String(event.eventType || '').toLowerCase());
		const events = () => {
			const found = new Map<string, any>();
			for (const day of data.workdays || []) for (const event of day.activity || []) found.set(String(event.id), { ...event, workdayId: day.id, category: eventCategory(event) });
			return [...found.values()];
		};
		const governanceRecords = () => (activeDay()?.governance || []).flatMap((proposal: any) => (proposal.events || []).map((event: any) => ({
			...event, id: 'governance:' + String(proposal.id) + ':' + String(event.id), sourceId: event.id,
			proposal, entityType: 'governance', workdayId: selectedDay, category: 'Governance',
			title: event.eventType || 'Governance transition', eyebrow: 'Governance',
			meta: (event.message || proposal.title || 'Proposal lifecycle') + ' · ' + fmt(event.createdAt),
			status: event.nextState || proposal.status || 'recorded',
		})));
		const totals = () => {
			const assignmentRuns = executions(), runs = providerAttempts(), days = data.workdays || [], roster = data.agents || [];
			return {
				agents: roster.length, activeAgents: new Set(assignmentRuns.filter((run: any) => run.status === 'running').map((run: any) => run.agentId).filter(Boolean)).size,
				workdays: days.length, completedDays: days.filter((day: any) => day.status === 'completed').length,
				events: events().length, assignments: assignments().length, executions: runs.length, artifacts: artifacts().length,
				passed: runs.filter((run: any) => ['completed', 'succeeded'].includes(run.status)).length,
				failed: runs.filter((run: any) => ['failed', 'error'].includes(run.status)).length,
				running: runs.filter((run: any) => run.status === 'running').length,
			};
		};
		const identity = () => {
			const repo = data.repositories?.[0] || {}, run = executions().find((entry: any) => entry.status === 'running') || executions().at(-1) || {};
			const fallbackName = String(data.sceneId || 'Simulation').replace(/^guide-/, '').replace(/-agent-lab$/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
			const labName = data.agents?.length === 1 ? data.agents[0].title : (data.sceneTitle || fallbackName);
			const primary = [
				['Connection', '<span class="connection ' + (connection.includes('offline') ? 'offline' : '') + '">' + esc(connection) + '</span>', ''],
				['Simulation', data.status || 'starting', ''],
				['Live clock', '<span data-live-clock>' + esc(fmt(new Date())) + '</span>', 'live-clock'],
				['Update lag', duration(data.generatedAt, new Date()), 'update-lag'],
				['Agent', run.agentId ? agentName(run.agentId) : 'awaiting assignment', 'optional'],
				['Profile', run.activityType || 'idle', 'optional'],
			];
			const secondary = [['Execution provider', run.executionProviderId || data.provider?.executionProviderId || 'Codex'], ['Timezone', data.timeZone], ['Cleanup', data.cleanup?.status || 'pending'], ['Repository', repo.slug || repo.name || 'Market'], ['Revision', String(revision)]];
			const chip = ([label, value, className = '']: string[]) => '<div class="identity-chip ' + className + '"><span>' + esc(label) + '</span><b>' + (String(value).startsWith('<span') ? value : esc(value || 'pending')) + '</b></div>';
			return '<header class="identity" id="identity-region"><div class="brand"><div class="sigil">TS</div><div><div class="eyebrow">Agent Lab</div><h1>Agent Lab: ' + esc(labName) + '</h1></div></div><div class="identity-grid">' + primary.map(chip).join('') + '<details class="identity-more"><summary>System info</summary><div class="identity-details">' + secondary.map((entry) => chip([entry[0] || '', entry[1] || ''])).join('') + '<button class="control copy-debug" data-copy-debug>Copy debug identity</button></div></details></div></header>';
		};
		const routeHref = (page: string, extra: Record<string,string> = {}) => {
			const route = new URLSearchParams({ page, workday: selectedDay, ...extra }); return '#' + esc(route.toString());
		};
		const metric = (key: string, value: number, label: string, detail: string, tone = '') => '<a class="metric ' + tone + '" href="' + routeHref('metric', { metric: key }) + '"><strong>' + value + '</strong><span>' + label + '</span><small>' + esc(detail) + '</small></a>';
		const metricRail = () => {
			const total = totals();
			return '<section class="metrics" id="metrics-region" aria-label="Simulation overview">' +
				metric('agents', total.agents, 'Agents', total.activeAgents + ' active') + metric('workdays', total.completedDays, 'Workdays', total.completedDays + ' / ' + total.workdays + ' complete') +
				metric('events', total.events, 'System events', 'durable transitions') + metric('assignments', total.assignments, 'Assignments', 'all profiles') +
				metric('executions', total.executions, 'Executions', 'provider attempts') + metric('artifacts', total.artifacts, 'Artifacts', 'unique outputs') +
				metric('passed', total.passed, 'Passed', 'successful attempts') + metric('failed', total.failed, 'Failed', 'failed attempts', 'danger') + metric('running', total.running, 'Running', 'live attempts', 'live') + '</section>';
		};
		const orchestrationHealth = () => {
			const day = activeDay(), totals = day?.accounting?.totals || {}, modeRuns = totals.modeRuns || {}, assignments = totals.assignments || {};
			const activeModeRuns = num(modeRuns.queued) + num(modeRuns.running), terminalDay = ['completed','failed','cancelled'].includes(day?.status);
			const issues = [
				terminalDay && activeModeRuns ? activeModeRuns + ' mode-run records remain active after the workday terminalized.' : '',
				num(assignments.completed) > num(day?.executions?.filter((run: any) => ['completed','succeeded'].includes(run.status)).length) ? 'Completed assignment evidence is missing from the execution projection.' : '',
				(day?.accounting?.settlement?.warnings || []).join(' '),
			].filter(Boolean);
			if (!issues.length) return '<section class="orchestration-health healthy"><b>Orchestration evidence coherent</b><span>Assignments, executions, accounting, and workday state agree.</span></section>';
			return '<section class="orchestration-health warning"><b>Orchestration evidence needs attention</b><span>' + esc(issues.join(' ')) + '</span><a href="' + routeHref('metric', { metric: 'workdays' }) + '">Inspect workday evidence</a></section>';
		};
		const navigation = () => {
			const tabs = [['monitor','Monitor'],['providers','Execution providers'],['events','Events'],['assignments','Assignments'],['artifacts','Artifacts']];
			const options = (data.workdays || []).map((day: any) => '<option value="' + esc(day.id) + '" ' + (day.id === selectedDay ? 'selected' : '') + '>' + esc(day.title + ' · ' + day.status) + '</option>').join('');
			return '<nav class="simulation-nav" id="navigation-region" aria-label="Simulation pages"><div class="page-tabs">' + tabs.map(([page,label]) => '<a href="' + routeHref(page) + '" aria-current="' + (currentPage === page ? 'page' : 'false') + '">' + label + '</a>').join('') + '</div><label class="workday-filter"><span>Workday</span><select data-workday-filter>' + options + '</select></label></nav>';
		};
		const gantt = () => {
			const day = (data.workdays || []).find((entry: any) => entry.id === selectedDay) || data.workdays?.[0];
			if (!day) return '<section class="module"><div class="gantt-empty">Awaiting a workday.</div></section>';
			const rows = providerAttempts(day), now = Date.now();
			const workdayStart = new Date(day.startedAt || Math.min(...rows.map((row: any) => new Date(row.startedAt).getTime()), now)).getTime();
			const workdayEnd = new Date(day.finishedAt || now).getTime();
			const end = workdayEnd + ganttOffsetMs;
			const start = ganttRangeMs ? Math.max(workdayStart, end - ganttRangeMs) : workdayStart;
			const span = Math.max(1, end - start);
			const ticks = Array.from({ length: 6 }, (_, index) => ({ pct: index * 20, at: new Date(start + span * index / 5) }));
			const grouped = new Map<string, any[]>();
			for (const run of rows) grouped.set(run.agentId || 'unclaimed', [...(grouped.get(run.agentId || 'unclaimed') || []), run]);
			const laneRows = [...grouped.entries()].map(([agentId, agentRuns]) => {
				const classId = agentRuns[0]?.agentClassId || 'unclassified';
				const profiles = new Map<string, any[]>();
				for (const run of agentRuns) {
					const profile = run.activityType || run.assignment?.decisionInput?.activityType || run.assignment?.mode || 'unknown';
					profiles.set(profile, [...(profiles.get(profile) || []), run]);
				}
				const profileLanes = [...profiles.entries()].map(([profile, profileRuns]) => {
					const laneEnds: number[] = [];
					const positioned = [...profileRuns].sort((left, right) => new Date(left.startedAt || start).getTime() - new Date(right.startedAt || start).getTime()).map((run) => {
						const runStart = new Date(run.startedAt || start).getTime(), runEnd = new Date(run.finishedAt || now).getTime();
						let overlapLane = laneEnds.findIndex((laneEnd) => laneEnd <= runStart); if (overlapLane < 0) overlapLane = laneEnds.length; laneEnds[overlapLane] = runEnd;
						const left = Math.max(0, Math.min(100, (runStart - start) / span * 100));
						const width = Math.max(.5, Math.min(100 - left, (runEnd - runStart) / span * 100));
						return '<button class="runbar ' + esc(run.status) + '" style="--profile:' + (profileColor[profile] || 'var(--unknown)') + ';left:' + left + '%;width:' + width + '%;top:' + (5 + overlapLane * 29) + 'px" data-key="run-' + esc(run.id || run.assignmentId) + '" data-focus-assignment="' + esc(run.assignmentId) + '" data-workday="' + esc(day.id) + '" title="' + esc(agentId + ' · ' + profile + ' · ' + duration(run.startedAt, run.finishedAt)) + '">' + esc(profile + ' · ' + run.status) + '</button>';
					}).join('');
					return '<div class="profile-lane" style="min-height:' + Math.max(40, laneEnds.length * 29 + 10) + 'px"><span class="profile-lane-label">' + esc(profile) + '</span>' + positioned + '</div>';
				}).join('');
				return '<div class="gantt-row" style="--class:' + hashColor(classId) + '" data-key="agent-' + esc(agentId) + '"><div class="agent-label"><b>' + esc(agentName(agentId)) + '</b><span>' + profiles.size + ' active profile' + (profiles.size === 1 ? '' : 's') + '</span></div><div class="lane">' + profileLanes + '</div></div>';
			}).join('');
			const intervals = rows.map((run: any) => '<button class="interval-card" data-focus-assignment="' + esc(run.assignmentId) + '" data-workday="' + esc(day.id) + '"><span><b>' + esc(agentName(run.agentId)) + '</b><small>' + esc(run.activityType || 'unknown') + '</small></span><span class="status ' + esc(run.status) + '">' + esc(run.status) + '</span><span><small>Window</small><b>' + esc(fmt(run.startedAt)) + ' → ' + esc(fmt(run.finishedAt)) + '</b></span><span><small>Credits</small><b>' + esc(run.credits?.actual || 0) + ' / ' + esc(run.credits?.requested || 0) + '</b></span></button>').join('');
			return '<section class="module" id="gantt-region"><div class="module-head"><div><div class="eyebrow">Live operational field</div><h2>Agent execution Gantt</h2></div><div class="controls"><button class="control" data-pan="back" aria-label="Pan earlier">←</button>' + [[300000,'5m'],[900000,'15m'],[3600000,'1h'],[0,'Workday']].map(([range,label]) => '<button class="control" data-range="' + range + '">' + label + '</button>').join('') + '<button class="control" data-pan="forward" aria-label="Pan later">→</button><span class="status ' + esc(day.status) + '">' + esc(day.status) + '</span></div></div><div class="gantt"><div class="axis">' + ticks.map((tick) => '<span class="tick" style="left:' + tick.pct + '%">' + esc(fmt(tick.at)) + '</span>').join('') + (!day.finishedAt ? '<span class="now" style="left:' + Math.max(0, Math.min(100, (now - start) / span * 100)) + '%"></span>' : '') + '</div><div class="gantt-rows">' + (laneRows || '<div class="gantt-empty">Awaiting the first active agent.</div>') + '</div><details class="interval-list"><summary>Execution interval list</summary><div role="list">' + (intervals || '<div class="empty">No execution intervals.</div>') + '</div></details></div></section>';
		};
		const eventCard = (event: any) => '<article class="system-event ' + esc(event.severity) + '" id="event-' + esc(event.id) + '"><div class="event-top"><b>' + esc(event.eventType) + '</b><span class="status ' + esc(event.severity) + '">' + esc(event.severity) + '</span><span class="meta">' + esc(event.category) + ' · ' + esc(fmt(event.timestamp)) + '</span></div><p>' + esc(event.summary) + '</p><details><summary>Event information</summary>' + structured(event) + '</details></article>';
		const evidenceItem = (entry: any) => '<details class="evidence" id="evidence-' + esc(entry.id) + '"><summary><span class="status ' + esc(entry.status) + '">' + esc(entry.status || 'recorded') + '</span><b>' + esc(entry.label) + '</b><time class="meta">' + esc(fmt(entry.timestamp)) + '</time></summary><div class="evidence-body">' + (entry.summary ? '<p>' + esc(entry.summary) + '</p>' : '') + structured(entry.detail) + '</div></details>';
		const creditStrip = (credits: any = {}) => {
			const values = [['Estimated', credits.estimated], ['Requested', credits.requested], ['Reserved', credits.reserved], ['Actual', credits.actual], ['Released', credits.released], ['Refunded', credits.refunded], ['Overrun', credits.overrun]];
			return '<div class="credit-strip" aria-label="Assignment credit accounting">' + values.map(([label, value]) => '<div><span>' + label + '</span><strong>' + (value === null || value === undefined ? 'not reported' : esc(value)) + '</strong></div>').join('') + '</div>';
		};
		const contextOverview = (evidence: any[]) => {
			const packs = evidence.filter((entry: any) => entry.kind === 'context-pack');
			if (!packs.length) return '<section class="context-overview missing"><h5>Context window</h5><p>No context-pack telemetry was recorded. Inspect execution preparation and provider diagnostics to locate the missing collection stage.</p></section>';
			const totals = packs.reduce((sum: any, entry: any) => { const stats = entry.detail?.statistics || {}; return { files: sum.files + num(stats.fileCount), results: sum.results + num(stats.resultCount), bytes: sum.bytes + num(stats.totalBytes), characters: sum.characters + num(stats.totalCharacters), tokens: sum.tokens + num(stats.tokenEstimate) }; }, { files: 0, results: 0, bytes: 0, characters: 0, tokens: 0 });
			const packCards = packs.map((entry: any, index: number) => {
				const pack = entry.detail || {}, stats = pack.statistics || {}, files = pack.files || [], queries = pack.queries || [];
				const fileCards = files.map((file: any) => '<article class="context-file"><div><b>' + esc(file.path || 'Unnamed result') + '</b><span>' + esc(file.mediaType || 'unknown type') + ' · ' + esc(file.bytes || 0) + ' bytes · ' + esc(file.characters || 0) + ' chars' + (file.tokenEstimate ? ' · ~' + esc(file.tokenEstimate) + ' tokens' : '') + (file.truncated ? ' · truncated' : '') + '</span></div>' + (file.content ? '<details><summary>Inspect captured content</summary><pre>' + esc(file.content) + '</pre></details>' : '') + '</article>').join('');
				return '<details class="context-pack"><summary><b>' + esc(pack.purpose || entry.label || ('Context pack ' + (index + 1))) + '</b><span>' + esc(stats.fileCount || 0) + ' files · ' + esc(stats.totalBytes || 0) + ' bytes · ~' + esc(stats.tokenEstimate || 0) + ' tokens</span></summary><div class="context-pack-body">' + (queries.length ? '<h6>TreeDX queries</h6>' + structured(queries) : '<p class="meta">No query inputs were recorded for this pack.</p>') + '<h6>Composition</h6>' + (fileCards || '<div class="empty">The pack record contains no materialized file results.</div>') + '</div></details>';
			}).join('');
			return '<section class="context-overview"><div class="context-heading"><div><h5>Context window</h5><p>Exact sanitized inputs assembled before execution-provider invocation.</p></div><div class="context-totals"><b>' + totals.files + ' files</b><b>' + totals.results + ' results</b><b>' + totals.bytes + ' bytes</b><b>' + totals.characters + ' chars</b><b>~' + totals.tokens + ' tokens</b></div></div>' + packCards + '</section>';
		};
		const signalOverview = (signals: any[] = []) => {
			if (!signals.length) return '<section class="context-overview missing"><h5>Handoff signals</h5><p>No output signal was recorded. Downstream profiles cannot treat this assignment as a completed handoff.</p></section>';
			const cards = signals.map((signal: any) => '<article class="context-file"><div><b>' + esc(signal.code || 'Unnamed signal') + '</b><span>' + esc(signal.severity || 'recorded') + (signal.metadata?.source ? ' · ' + esc(signal.metadata.source) : '') + '</span></div>' + (signal.message ? '<p>' + esc(signal.message) + '</p>' : '') + '</article>').join('');
			return '<section class="context-overview"><div class="context-heading"><div><h5>Handoff signals</h5><p>Validated outputs available to downstream activity-profile gates.</p></div><div class="context-totals"><b>' + signals.length + ' produced</b></div></div>' + cards + '</section>';
		};
		const assignmentDetail = (run: any, day: any) => {
			const assignment = Object.keys(run.assignment || {}).length ? run.assignment : (day.assignments || []).find((entry: any) => String(entry.id) === String(run.assignmentId)) || {};
			const agent = (data.agents || []).find((entry: any) => entry.id === run.agentId) || {};
			const evidence = run.evidence || [];
			const assignmentInput = assignment.decisionInput?.input || assignment.decision_input_json?.input || {}, intent = assignmentInput.intent || {};
			const timeline = evidence.length ? evidence.map(evidenceItem).join('') : '<div class="empty">No execution evidence captured.</div>';
			const preparation = evidence.filter((entry: any) => ['Assignment execution context prepared', 'TreeDX and execution context ready', 'Execution context preparation failed'].includes(entry.label)).map((entry: any) => ({ stage: entry.label, status: entry.status, summary: entry.summary, details: entry.detail }));
			const agentInfo = { name: agent.title || agentName(run.agentId), class: agent.classTitle || agent.classId, description: agent.description, identity: agent.identity, activityProfile: run.activityType, handler: run.handlerTitle || run.handlerId, enabledHandlers: (agent.activityProfiles || []).filter((profile: any) => profile.enabled).map((profile: any) => ({ activityProfile: profile.activityType, handler: profile.handlerId })), executionProvider: run.executionProviderId || 'Codex', credits: run.credits, usage: run.usage };
			const envelope = assignment.capacityEnvelope || assignment.capacity_envelope_json || {}, decision = assignment.decisionInput || assignment.decision_input_json || {}, metadata = decision.metadata || {};
			const assignmentInfo = { title: assignment.title || assignmentInput.title, request: assignment.request || assignmentInput.objective || intent.objective, subject: { model: assignmentInput.subjectModel || intent.subjectModel, id: assignmentInput.subjectId || intent.subjectId, path: assignmentInput.subjectPath || intent.subjectPath, upstreamArtifacts: assignmentInput.relatedArtifacts || intent.relatedArtifacts || [assignmentInput.relatedArtifact || intent.relatedArtifact].filter(Boolean) }, sourceContext: { type: assignment.sourceType, model: assignmentInput.model, path: assignmentInput.subjectPath || assignmentInput.contentPath }, status: assignment.status || run.status, activityProfile: run.activityType, handler: run.handlerTitle || run.handlerId, matchingExplanation: assignment.matchingExplanation || assignment.matching, governance: { decision: assignmentInput.decision, humanApprovalState: decision.humanApprovalState, planningInputsStatus: decision.planningInputsStatus, capacityPlanId: metadata.capacityPlanId, capacityPlanStatus: metadata.capacityPlanStatus, readiness: metadata.readiness || assignment.readiness }, executionPreparation: preparation, capabilities: envelope.requiredCapabilities || assignment.requiredCapabilities, lease: { state: assignment.leaseState, expiresAt: assignment.leaseExpiresAt, runner: assignment.runnerId }, credits: run.credits, allowedOutputs: assignment.allowedOutputs || assignmentInput.expectedOutputs || assignmentInput.acceptanceCriteria };
			return '<div class="assignment-body">' + creditStrip(run.credits) + contextOverview(evidence) + signalOverview(run.signals) + '<div class="assignment-panels"><section class="assignment-panel"><h5>1 / Assignment information</h5>' + structured(assignmentInfo) + '</section><section class="assignment-panel"><h5>2 / Agent information</h5>' + structured(agentInfo) + '</section><section class="assignment-panel"><h5>3 / Agent assignment timeline</h5><div class="evidence-list">' + timeline + '</div></section></div><details class="forensic"><summary>Complete sanitized forensic records · ' + (run.transcript || []).length + '</summary><pre>' + esc(JSON.stringify(run.transcript || [], null, 2)) + '</pre></details></div>';
		};
		const activeDay = () => (data.workdays || []).find((day: any) => day.id === selectedDay) || data.workdays?.[0];
		const dayExecutions = () => activeDay()?.executions || [];
		const providerLogs = () => {
			const kinds = new Set(['context-pack','work-package','provider-invocation','agent-message','reasoning','tool-call','tool-result','treedx-call','provider-output','diagnostic']);
			return dayExecutions().flatMap((run: any) => (run.evidence || []).filter((entry: any) => kinds.has(entry.kind)).map((entry: any) => ({ ...entry, run, entityType: 'provider' }))).sort((a: any,b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
		};
		const metricValue = (key: string, at: number) => {
			const day = activeDay(), runs = day?.executions || [], attempts = providerAttempts(day), before = (value: any) => new Date(String(value || 0)).getTime() <= at;
			if (key === 'agents') return new Set(runs.filter((run: any) => before(run.startedAt)).map((run: any) => run.agentId).filter(Boolean)).size;
			if (key === 'workdays') return (data.workdays || []).filter((entry: any) => entry.finishedAt && before(entry.finishedAt)).length;
			if (key === 'events') return (day?.activity || []).filter((entry: any) => before(entry.timestamp)).length;
			if (key === 'assignments') return assignments().filter((assignment: any) => assignment.workdayId === selectedDay && before(assignment.createdAt || assignment.assignedAt || assignment.leasedAt)).length;
			if (key === 'executions') return attempts.filter((run: any) => before(run.startedAt)).length;
			if (key === 'artifacts') return runs.flatMap((run: any) => (run.artifacts || []).map((artifact: any) => ({ artifact, at: artifact.createdAt || run.finishedAt || run.startedAt }))).filter((entry: any) => before(entry.at)).length;
			if (key === 'passed') return attempts.filter((run: any) => ['completed','succeeded'].includes(run.status) && before(run.finishedAt)).length;
			if (key === 'failed') return attempts.filter((run: any) => ['failed','error'].includes(run.status) && before(run.finishedAt)).length;
			return attempts.filter((run: any) => before(run.startedAt) && (!run.finishedAt || new Date(run.finishedAt).getTime() > at)).length;
		};
		const lineChart = (keys: string[], title: string) => {
			const day = activeDay(), now = Date.now(), start = new Date(day?.startedAt || now).getTime(), end = new Date(day?.finishedAt || now).getTime(), span = Math.max(1,end-start);
			const points = Array.from({ length: 25 }, (_, index) => start + span * index / 24), max = Math.max(1,...keys.flatMap((key) => points.map((at) => metricValue(key,at))));
			const colors = ['var(--ion)','var(--live)','var(--warn)','var(--danger)','var(--reviewing)','var(--reporting)','#70f5b0','#91a3aa','#eef7f2'];
			const paths = keys.map((key,index) => '<polyline points="' + points.map((at,i) => (i / 24 * 900) + ',' + (190 - metricValue(key,at) / max * 160)).join(' ') + '" fill="none" stroke="' + colors[index % colors.length] + '" stroke-width="3"><title>' + esc(key) + '</title></polyline>').join('');
			return '<section class="module trend" id="trend-region"><div class="module-head"><div><div class="eyebrow">Workday telemetry</div><h2>' + esc(title) + '</h2></div><div class="trend-legend">' + keys.map((key,index) => '<span style="--series:' + colors[index % colors.length] + '">' + esc(key) + '</span>').join('') + '</div></div><div class="chart-scroll"><svg viewBox="0 0 900 220" role="img" aria-label="' + esc(title) + '"><path class="chart-grid" d="M0 30H900M0 70H900M0 110H900M0 150H900M0 190H900"/>' + paths + '<text x="0" y="214">' + esc(fmt(start)) + '</text><text x="900" y="214" text-anchor="end">' + esc(fmt(end)) + '</text></svg></div></section>';
		};
		const filterState = () => filters[currentPage + ':' + metricKey] ||= { query: '', status: '', profile: '' };
		const listControls = (items: any[]) => {
			const state = filterState(), statuses = [...new Set(items.map((item) => item.status || item.severity).filter(Boolean))], profiles = [...new Set(items.map((item) => item.activityType || item.run?.activityType).filter(Boolean))];
			return '<form class="list-filters" data-list-filters><label><span>Search</span><input value="' + esc(state.query) + '" data-filter="query" placeholder="Filter this view"></label><label><span>Status</span><select data-filter="status"><option value="">All statuses</option>' + statuses.map((value) => '<option ' + (state.status === value ? 'selected' : '') + '>' + esc(value) + '</option>').join('') + '</select></label><label><span>Profile</span><select data-filter="profile"><option value="">All profiles</option>' + profiles.map((value) => '<option ' + (state.profile === value ? 'selected' : '') + '>' + esc(value) + '</option>').join('') + '</select></label>' + (currentPage === 'events' ? '<label class="tick-toggle"><input type="checkbox" data-show-ticks ' + (showWorkdayTicks ? 'checked' : '') + '> Include ticks</label>' : '') + '</form>';
		};
		const entityCard = (item: any) => '<button class="entity-card" data-key="entity-' + esc(item.entityType + '-' + item.id) + '" data-open-entity="' + esc(item.entityType) + '" data-entity-id="' + esc(item.id) + '" data-workday="' + esc(item.workdayId || selectedDay) + '"><span class="entity-kind">' + esc(item.eyebrow || item.entityType) + '</span><strong>' + esc(item.title || item.label || item.name || 'Recorded item') + '</strong><span class="entity-meta">' + esc(item.meta || '') + '</span>' + (item.status || item.severity ? '<span class="status ' + esc(item.status || item.severity) + '">' + esc(item.status || item.severity) + '</span>' : '') + '</button>';
		const filterItems = (items: any[]) => { const state = filterState(), query = state.query.toLowerCase(); return items.filter((item) => (!query || JSON.stringify(item).toLowerCase().includes(query)) && (!state.status || (item.status || item.severity) === state.status) && (!state.profile || (item.activityType || item.run?.activityType) === state.profile)); };
		const listPage = (title: string, description: string, items: any[]) => '<section class="list-page"><div class="page-heading"><div><div class="eyebrow">' + esc(activeDay()?.title || 'Simulation') + '</div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div><span class="record-count">' + filterItems(items).length + ' / ' + items.length + '</span></div>' + listControls(items) + '<div class="entity-list" id="entity-list">' + (filterItems(items).map(entityCard).join('') || '<div class="empty">No records match this view.</div>') + '</div></section>';
		const pageItems = (page: string, metric = ''): any[] => {
			const day = activeDay(), runs = day?.executions || [], attempts = providerAttempts(day);
			if (page === 'providers') return providerLogs().map((item: any) => ({ ...item, id: item.id, title: item.label, eyebrow: item.kind, meta: agentName(item.run.agentId) + ' · ' + fmt(item.timestamp), status: item.status || item.run.status }));
			if (page === 'events' || metric === 'events') return [...(day?.activity || []).filter((item: any) => showWorkdayTicks || !isWorkdayTick(item)).map((item: any) => ({ ...item, entityType: 'event', title: item.eventType, eyebrow: eventCategory(item), meta: item.summary + ' · ' + fmt(item.timestamp) })), ...governanceRecords()];
			if (page === 'assignments' || metric === 'assignments') return assignments().filter((item: any) => item.workdayId === selectedDay).map((item: any) => { const run = assignmentRun(item.id)?.run || {}, input = item.decisionInput?.input || item.decision_input_json?.input || {}; return { ...item, ...run, entityType: 'assignment', id: item.id, title: item.title || input.title || ((run.activityType || item.mode || 'pending') + ' assignment'), eyebrow: run.activityType || input.activityType || item.mode || 'pending', meta: agentName(run.agentId || item.agentId) + ' · ' + (run.handlerTitle || run.handlerId || item.handlerId || 'handler pending') }; });
			if (page === 'artifacts' || metric === 'artifacts') return artifacts().filter((item: any) => item.workdayId === selectedDay).map((item: any) => ({ ...item, id: item.id || item.uri || item.name, entityType: 'artifact', title: item.name || item.uri, eyebrow: item.kind || 'artifact', meta: agentName(item.agentId) }));
			if (metric === 'agents') return (data.agents || []).map((agent: any) => ({ ...agent, entityType: 'agent', status: runs.some((run: any) => run.agentId === agent.id && run.status === 'running') ? 'running' : 'configured', meta: (agent.activityProfiles || []).filter((entry: any) => entry.enabled).length + ' enabled profiles' }));
			if (metric === 'workdays') return (data.workdays || []).map((item: any) => ({ ...item, entityType: 'workday', meta: duration(item.startedAt,item.finishedAt) + ' · ' + (item.agentTests || []).length + ' tests' }));
			if (['executions','passed','failed','running'].includes(metric)) return attempts.filter((run: any) => metric === 'executions' || (metric === 'passed' ? ['completed','succeeded'].includes(run.status) : metric === 'failed' ? ['failed','error'].includes(run.status) : run.status === 'running')).map((run: any) => ({ ...run, entityType: 'execution', id: run.id || run.assignmentId, title: agentName(run.agentId) + ' · ' + (run.activityType || 'execution'), eyebrow: run.executionProvider || 'Codex', meta: duration(run.startedAt,run.finishedAt) + ' · ' + (run.credits?.actual ?? 0) + ' actual credits' }));
			return [];
		};
		const pageContent = () => {
			if (currentPage === 'monitor') return '<div class="monitor-page">' + orchestrationHealth() + gantt() + lineChart(['agents','events','assignments','executions','artifacts','passed','failed','running'],'Vital metrics over time') + '</div>';
			if (currentPage === 'metric') { const items = pageItems('metric',metricKey); return lineChart([metricKey], metricKey + ' over time') + listPage(metricKey, 'Filter the selected workday records and open any card for complete evidence.', items); }
			const copy: Record<string,[string,string]> = { providers: ['Execution provider records','Provider invocations, prompts, reasoning records, messages, tools, results, outputs, and diagnostics.'], events: ['System events','Durable control-plane transitions with workday ticks hidden by default.'], assignments: ['Assignments','Every observed assignment organized for production execution debugging.'], artifacts: ['Artifacts and modified content','Generated content, receipts, commits, diffs, source maps, and producer evidence.'] };
			return listPage(copy[currentPage]?.[0] || currentPage, copy[currentPage]?.[1] || '', pageItems(currentPage));
		};
		const nodeKey = (node: Node) => node instanceof HTMLElement ? (node.id || node.dataset.key || '') : '';
		const compatible = (current: Node, next: Node) => current.nodeType === next.nodeType
			&& (!(current instanceof Element) || !(next instanceof Element) || current.tagName === next.tagName);
		const morph = (current: Node, next: Node) => {
			if (current.nodeType === Node.TEXT_NODE) { if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue; return; }
			if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
			const preserveOpen = current instanceof HTMLDetailsElement;
			for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name) && !(preserveOpen && attribute.name === 'open')) current.removeAttribute(attribute.name);
			for (const attribute of [...next.attributes]) if (!(preserveOpen && attribute.name === 'open') && current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
			const existing = [...current.childNodes], keyed = new Map(existing.map((node) => [nodeKey(node), node]).filter(([key]) => Boolean(key)) as Array<[string, Node]>), used = new Set<Node>();
			for (const [index, nextChild] of [...next.childNodes].entries()) {
				const key = nodeKey(nextChild), indexed = current.childNodes[index];
				let match = key ? keyed.get(key) : (indexed && !nodeKey(indexed) && compatible(indexed, nextChild) ? indexed : undefined);
				if (!match || !compatible(match, nextChild)) match = nextChild.cloneNode(true);
				const position = current.childNodes[index]; if (match !== position) current.insertBefore(match, position || null);
				used.add(match); morph(match, nextChild);
			}
			for (const child of existing) if (!used.has(child) && child.parentNode === current) current.removeChild(child);
		};
		const clearDialogRoute = () => {
			openAssignmentId = null; dialogKind = null;
			const route = new URLSearchParams(location.hash.slice(1));
			for (const key of ['entity','entityId','assignment','execution','artifact','evidence']) route.delete(key);
			history.replaceState(null, '', location.pathname + location.search + (route.size ? '#' + route.toString() : ''));
		};
		const closeDialog = (restoreTrigger = true) => {
			restoreDialogTrigger = restoreTrigger; clearDialogRoute();
			root.querySelector<HTMLDialogElement>('#command-dialog')?.close();
		};
		const updateRegion = (id: string, html: string) => {
			const template = document.createElement('template'); template.innerHTML = html;
			const current = root.querySelector('#' + id), next = template.content.querySelector('#' + id); if (current && next) morph(current,next);
		};
		const render = (routeChanged = false) => {
			document.documentElement.dataset.revision = String(revision);
			const shellHtml = '<div class="shell">' + identity() + metricRail() + navigation() + '<main id="page-region">' + pageContent() + '</main></div>';
			if (!root.querySelector('#identity-region')) {
				root.innerHTML = shellHtml + '<dialog id="command-dialog"><div class="dialog-head"><h2 id="dialog-title">Simulation detail</h2><button class="dialog-close" aria-label="Close">×</button></div><div class="dialog-content" id="dialog-content"></div></dialog>';
				const dialog = root.querySelector<HTMLDialogElement>('#command-dialog');
				dialog?.addEventListener('cancel', clearDialogRoute);
				dialog?.addEventListener('close', () => {
					clearDialogRoute();
					if (restoreDialogTrigger) lastTrigger?.focus({ preventScroll: true });
					restoreDialogTrigger = true;
				});
			} else {
				updateRegion('identity-region',identity()); updateRegion('metrics-region',metricRail());
				if (routeChanged) updateRegion('navigation-region',navigation());
				updateRegion('page-region','<main id="page-region">' + pageContent() + '</main>');
			}
			refreshDialog();
		};
		const assignmentRun = (assignmentId: string) => {
			const executed = (data.workdays || []).flatMap((day: any) => (day.executions || []).map((run: any) => ({ day, run }))).find((entry: any) => entry.run.assignmentId === assignmentId); if (executed) return executed;
			for (const day of data.workdays || []) { const assignment = (day.assignments || []).find((item: any) => String(item.id) === String(assignmentId)); if (!assignment) continue; const input = assignment.decisionInput?.input || assignment.decision_input_json?.input || {}, envelope = assignment.capacityEnvelope || assignment.capacity_envelope_json || {}, requested = num(envelope.requestedCredits ?? envelope.expectedCredits ?? envelope.reservedCredits); return { day, run: { assignmentId, assignment, agentId: assignment.agentId, agentClassId: assignment.projectAgentClassId, activityType: input.activityType || assignment.mode, handlerId: assignment.handlerId, status: assignment.status, startedAt: assignment.leasedAt || assignment.createdAt, finishedAt: assignment.completedAt || assignment.failedAt, executionProviderId: assignment.executionProviderId, transcript: [], evidence: [], signals: [], artifacts: [], usage: {}, error: null, credits: { estimated: requested, requested, reserved: num(envelope.reservedCredits), actual: 0, released: 0, refunded: 0, overrun: 0 } } }; }
			return undefined;
		};
		const entityDetail = (kind: string, id: string) => {
			if (kind === 'assignment') { const found = assignmentRun(id); return found ? assignmentDetail(found.run,found.day) : '<div class="empty">Assignment evidence is not available yet.</div>'; }
			if (kind === 'provider') { const item = providerLogs().find((entry: any) => String(entry.id) === id); return item ? '<section class="detail-lead"><h3>' + esc(item.label) + '</h3><p>' + esc(item.summary) + '</p></section>' + structured({ providerRecord: item.detail, agent: agentName(item.run.agentId), activityProfile: item.run.activityType, handler: item.run.handlerTitle || item.run.handlerId, executionProvider: item.run.executionProvider || 'Codex', timestamp: fmt(item.timestamp) }) : '<div class="empty">Provider record unavailable.</div>'; }
			if (kind === 'event') { const item = (activeDay()?.activity || []).find((entry: any) => String(entry.id) === id); return item ? eventCard({ ...item, category: eventCategory(item) }) + '<details class="forensic"><summary>Complete sanitized event record</summary><pre>' + esc(JSON.stringify(item,null,2)) + '</pre></details>' : '<div class="empty">Event unavailable.</div>'; }
			if (kind === 'governance') { const item = governanceRecords().find((entry: any) => String(entry.id) === id); return item ? '<section class="detail-lead"><h3>' + esc(item.eventType || 'Governance transition') + '</h3><p>' + esc(item.message || item.proposal?.summary) + '</p></section>' + structured({ actorType: item.actorType, proposal: { title: item.proposal?.title, status: item.proposal?.status, summary: item.proposal?.summary }, transition: { priorState: item.priorState, nextState: item.nextState }, vote: item.proposal?.votes, decision: item.proposal?.decision, evidence: item.evidence, timestamp: fmt(item.createdAt) }) : '<div class="empty">Governance evidence unavailable.</div>'; }
			if (kind === 'artifact') { const item = artifacts().find((entry: any) => String(entry.id || entry.uri || entry.name) === id); return item ? '<section class="detail-lead"><h3>' + esc(item.name || item.uri) + '</h3><p>Generated by ' + esc(agentName(item.agentId)) + '</p></section>' + structured(item) : '<div class="empty">Artifact unavailable.</div>'; }
			if (kind === 'agent') { const item = (data.agents || []).find((entry: any) => String(entry.id) === id), runs = executions().filter((run: any) => run.agentId === id), profiles = item?.activityProfiles || []; return item ? '<section class="detail-lead"><h3>' + esc(item.title) + '</h3><p>' + esc(item.description) + '</p></section>' + creditStrip({ estimated: runs.reduce((sum: number,run: any) => sum + num(run.credits?.estimated),0), actual: runs.reduce((sum: number,run: any) => sum + num(run.credits?.actual),0) }) + structured({ identity: item.identity, class: item.classTitle || item.classId, capabilities: item.capabilities, enabledHandlers: profiles.filter((profile: any) => profile.enabled).map((profile: any) => ({ activityProfile: profile.activityType, handler: profile.handlerId })), activityProfiles: profiles, executions: runs.length, tokenUsage: runs.map((run: any) => run.usage) }) : '<div class="empty">Agent unavailable.</div>'; }
			if (kind === 'workday') { const item = (data.workdays || []).find((entry: any) => String(entry.id) === id); return item ? structured({ title: item.title, status: item.status, started: fmt(item.startedAt), finished: fmt(item.finishedAt), duration: duration(item.startedAt,item.finishedAt), tests: item.agentTests, accounting: item.accounting, assertions: item.assertions, diagnostics: item.diagnostics }) : '<div class="empty">Workday unavailable.</div>'; }
			if (kind === 'execution') { const item = providerAttempts(activeDay()).find((entry: any) => String(entry.id || entry.assignmentId) === id), found = item && assignmentRun(item.assignmentId); return found ? assignmentDetail(found.run,found.day) : structured(item); }
			return '<div class="empty">No detail renderer exists for this record.</div>';
		};
		const refreshDialog = () => {
			if (!openAssignmentId || !dialogKind) return; const content = root.querySelector<HTMLElement>('#dialog-content'); if (!content) return;
			const top = content.scrollTop, template = document.createElement('template'); template.innerHTML = '<div class="dialog-content" id="dialog-content">' + entityDetail(dialogKind,openAssignmentId) + '</div>'; const next = template.content.firstElementChild;
			if (next) morph(content, next);
			content.scrollTop = top;
		};
		const openEntity = (kind: string, id: string, trigger: HTMLElement, updateHash = true) => {
			openAssignmentId = id; dialogKind = kind; lastTrigger = trigger; const dialog = root.querySelector<HTMLDialogElement>('#command-dialog'), title = root.querySelector('#dialog-title'), content = root.querySelector<HTMLElement>('#dialog-content'); if (!dialog || !title || !content) return;
			title.textContent = kind === 'provider' ? 'Execution provider record' : kind; content.innerHTML = entityDetail(kind,id); if (!dialog.open) dialog.showModal(); content.focus({ preventScroll: true });
			if (updateHash) { const route = new URLSearchParams(location.hash.slice(1)); route.set('page',currentPage); route.set('workday',selectedDay); route.set('entity',kind); route.set('entityId',id); history.replaceState(null,'',location.pathname + location.search + '#' + route.toString()); }
		};
		const focusAssignment = (workdayId: string, assignmentId: string, updateHash = true) => {
			if (workdayId && workdayId !== selectedDay) { selectedDay = workdayId; render(true); } const target = root.querySelector<HTMLElement>('[data-entity-id="' + CSS.escape(assignmentId) + '"],#assignment-' + CSS.escape(assignmentId));
			if (target && assignmentRun(assignmentId)) openEntity('assignment',assignmentId,target,updateHash);
		};
		const applyHash = (scroll = true) => {
			const params = new URLSearchParams(location.hash.slice(1)), day = params.get('workday'), page = params.get('page') || 'monitor', metric = params.get('metric') || '', entity = params.get('entity'), entityId = params.get('entityId'), assignment = params.get('assignment');
			if (!entity && !assignment && root.querySelector<HTMLDialogElement>('#command-dialog')?.open) closeDialog(false);
			if (day && (data.workdays || []).some((entry: any) => entry.id === day)) selectedDay = day;
			currentPage = page; metricKey = metric; if (scroll) render(true);
			if (entity && entityId && (openAssignmentId !== entityId || dialogKind !== entity)) { const trigger = root.querySelector<HTMLElement>('[data-entity-id="' + CSS.escape(entityId) + '"]'); if (trigger) openEntity(entity,entityId,trigger,false); }
			else if (assignment && openAssignmentId !== assignment) focusAssignment(selectedDay, assignment, false);
		};
		root.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			const copyButton = target.closest<HTMLElement>('[data-copy-debug]'); if (copyButton) {
				const repo = data.repositories?.[0] || {}, run = executions().find((entry: any) => entry.status === 'running') || executions().at(-1) || {};
				const debugIdentity = { sceneId: data.sceneId, runId: data.runId, teamId: data.team?.id, projectId: repo.projectId, repositoryRef: repo.ref, providerId: data.provider?.id, runnerId: run.runnerId, executionProviderId: run.executionProviderId || data.provider?.executionProviderId, revision };
				navigator.clipboard?.writeText(JSON.stringify(debugIdentity, null, 2)).then(() => { copyButton.textContent = 'Copied'; setTimeout(() => { copyButton.textContent = 'Copy debug identity'; }, 1200); }); return;
			}
			const rangeButton = target.closest<HTMLElement>('[data-range]'); if (rangeButton) { ganttRangeMs = num(rangeButton.dataset.range) || null; ganttOffsetMs = 0; render(); return; }
			const panButton = target.closest<HTMLElement>('[data-pan]'); if (panButton) { const step = Math.max(60_000, (ganttRangeMs || 3_600_000) / 3); ganttOffsetMs += panButton.dataset.pan === 'back' ? -step : step; render(); return; }
			if (target.closest('.dialog-close')) { closeDialog(); return; }
			const entityButton = target.closest<HTMLElement>('[data-open-entity]'); if (entityButton) { openEntity(entityButton.dataset.openEntity || '',entityButton.dataset.entityId || '',entityButton); return; }
			const assignmentButton = target.closest<HTMLElement>('[data-focus-assignment]'); if (assignmentButton) { focusAssignment(assignmentButton.dataset.workday || selectedDay, assignmentButton.dataset.focusAssignment || ''); }
		});
		root.addEventListener('input', (event) => { const input = event.target as HTMLInputElement | HTMLSelectElement; if (input.matches('[data-show-ticks]')) { showWorkdayTicks = (input as HTMLInputElement).checked; render(); return; } const key = input.dataset.filter; if (!key) return; (filterState() as any)[key] = input.value; render(); });
		root.addEventListener('change', (event) => { const input = event.target as HTMLSelectElement; if (!input.matches('[data-workday-filter]')) return; selectedDay = input.value; closeDialog(false); const route = new URLSearchParams(location.hash.slice(1)); route.set('page',currentPage); route.set('workday',selectedDay); history.pushState(null,'',location.pathname + location.search + '#' + route.toString()); render(true); });
		window.addEventListener('hashchange', () => applyHash());
		render();
		applyHash(true);
		setInterval(() => { for (const clock of root.querySelectorAll<HTMLElement>('[data-live-clock]')) clock.textContent = fmt(new Date()); }, 1_000);
		if (location.protocol.startsWith('http')) {
			const renderLiveUpdate = () => render();
			const connect = () => {
				const feed = new EventSource('/events');
				feed.onopen = () => { connection = 'live'; renderLiveUpdate(); };
				feed.addEventListener('delta', (event: MessageEvent) => { try { const update = JSON.parse(event.data); if (update.revision <= revision) return; if (update.revision !== revision + 1) { fetch('/snapshot').then((response) => response.json()).then((full) => { data = full.snapshot; revision = full.revision; connection = 'live'; renderLiveUpdate(); }); return; } data = update.value; revision = update.revision; connection = 'live'; renderLiveUpdate(); } catch { connection = 'degraded'; renderLiveUpdate(); } });
				feed.onerror = () => { connection = 'reconnecting'; renderLiveUpdate(); feed.close(); setTimeout(connect, 1_500); };
			}; connect();
		}
	}
	return `(function(){const __name=function(target){return target;};(${boot.toString()})()})()`;
}
