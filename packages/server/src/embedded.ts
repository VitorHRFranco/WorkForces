import { main } from "./embedded-run.js";

// O ponto de entrada do processo filho; a lógica fica em embedded-run.ts, que os testes importam sem efeito colateral.
void main();
