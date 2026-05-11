import { createRailwayTreeseedApiServer } from '@treeseed/agent/api';

const server = await createRailwayTreeseedApiServer();
console.log(`Treeseed project API listening on ${server.url}`);
