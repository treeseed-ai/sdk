import { describe,expect,it } from 'vitest';
import { assignmentTimeWindow } from '../../../../../src/agent-capacity/contracts/support/time-capacity.ts';

describe('assignment time windows',()=>{
	const base={ requestedSeconds:600,executionSeconds:600,preparationSeconds:180,closeoutSeconds:120,reservedSeconds:600,activeSeconds:0,elapsedSeconds:0,releasedSeconds:0,overrunSeconds:0,
		preparationDeadlineAt:'2026-08-14T12:03:00.000Z',executionStartedAt:null,executionDeadlineAt:null,closeoutDeadlineAt:'2026-08-14T12:05:00.000Z' };
	it('does not consume productive execution during bounded preparation',()=>{
		expect(assignmentTimeWindow(base,Date.parse('2026-08-14T12:02:00.000Z'))).toMatchObject({ phase:'preparation',preparationRemainingSeconds:60,executionRemainingSeconds:600,shouldCloseOut:false });
	});
	it('reports the full productive window after the initial plan transition',()=>{
		const active={ ...base,executionStartedAt:'2026-08-14T12:02:00.000Z',executionDeadlineAt:'2026-08-14T12:12:00.000Z',closeoutStartedAt:'2026-08-14T12:12:00.000Z',closeoutDeadlineAt:'2026-08-14T12:14:00.000Z' };
		expect(assignmentTimeWindow(active,Date.parse('2026-08-14T12:02:00.000Z'))).toMatchObject({ phase:'working',executionRemainingSeconds:600 });
		expect(assignmentTimeWindow(active,Date.parse('2026-08-14T12:12:30.000Z'))).toMatchObject({ phase:'closeout',closeoutRemainingSeconds:90,shouldCloseOut:true });
		expect(assignmentTimeWindow(active,Date.parse('2026-08-14T12:14:00.000Z'))).toMatchObject({ phase:'expired',closeoutRemainingSeconds:0,shouldCloseOut:true });
	});
});
