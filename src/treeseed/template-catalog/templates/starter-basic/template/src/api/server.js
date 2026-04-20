import { createRailwayTreeseedApiServer } from '@treeseed/core/api';

const server = await createRailwayTreeseedApiServer();
console.log(`Treeseed project API listening on ${server.url}`);
