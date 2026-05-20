import { createRailwayTreeseedApiServer } from '@treeseed/sdk/api';

const server = await createRailwayTreeseedApiServer();
console.log(`Treeseed project API listening on ${server.url}`);
