import {RNG} from "../rng";
import {buffer, Color, Model, Resolution, Tile} from "./model";

// origin: https://github.com/mxgmn/WaveFunctionCollapse/

export class OverlappingModel<T> extends Model {
  N: number;
  patterns: number[][]; // array of patterns
  tiles: Tile<T>[];
  ground: number;
  private readonly _constraints: Constraint<T>[];

  constructor(
    input: Tile<T>[][], // y >> x
    N: number,
    rng: RNG,
    width: number,
    height: number,
    periodicInput: boolean,
    periodicOutput: boolean,
    symmetry: number,
    ground: number,
    constraints: Constraint<T>[]
  ) {
    super(rng, width, height);

    this.N = N;
    this.periodic = periodicOutput;
    this._constraints = constraints;
    const SMY = input.length;
    const SMX = input[0].length;
    this.tiles = [];
    const sample: number[][] = [];

    for (let y = 0; y < SMY; y++) {
      sample[y] = [];
      for (let x = 0; x < SMX; x++) {
        const tile = input[y][x];
        let i = 0;
        for (const t of this.tiles) {
          if (t.equals(tile)) {
            break;
          }
          i++;
        }
        if (i == this.tiles.length) {
          this.tiles.push(tile);
        }
        sample[y][x] = i;
      }
    }

    const C = this.tiles.length;
    const W = Math.pow(C, N * N);

    function pattern(f: (x: number, y: number) => number): number[] {
      const result = [];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          result.push(f(x, y));
        }
      }
      return result;
    }

    function patternFromSample(x: number, y: number): number[] {
      return pattern((dx, dy) => sample[(y + dy) % SMY][(x + dx) % SMX]);
    }

    function rotate(p: number[]): number[] {
      return pattern((x, y) => p[N - 1 - y + x * N]);
    }

    function reflect(p: number[]): number[] {
      return pattern((x, y) => p[N - 1 - x + y * N]);
    }

    function index(p: number[]): number {
      let result = 0, power = 1;
      for (let i = 0; i < p.length; i++) {
        result += p[p.length - 1 - i] * power;
        power *= C;
      }
      return result;
    }

    function patternFromIndex(ind: number): number[] {
      let residue = ind, power = W;
      const result: number[] = [];
      for (let i = 0; i < N * N; i++) {
        power /= C;
        let count = 0;
        while (residue >= power) {
          residue -= power;
          count++;
        }
        result.push(count);
      }
      return result;
    }

    const weights = new Map<number, number>(); // pattern index => weight

    for (let y = 0; y < (periodicInput ? SMY : SMY - N + 1); y++) {
      for (let x = 0; x < (periodicInput ? SMX : SMX - N + 1); x++) {
        const ps: number[][] = [];

        ps[0] = patternFromSample(x, y);
        ps[1] = reflect(ps[0]);
        ps[2] = rotate(ps[0]);
        ps[3] = reflect(ps[2]);
        ps[4] = rotate(ps[2]);
        ps[5] = reflect(ps[4]);
        ps[6] = rotate(ps[4]);
        ps[7] = reflect(ps[6]);

        for (let k = 0; k < symmetry; k++) {
          const ind = index(ps[k]);
          const weight = weights.get(ind) || 0;
          weights.set(ind, weight + 1);
        }
      }
    }

    this.T = weights.size; // patterns count
    this.ground = (ground + this.T) % this.T;
    this.patterns = [];
    this.weights = [];

    for (const [index, weight] of weights) {
      this.patterns.push(patternFromIndex(index));
      this.weights.push(weight);
    }

    // console.log("weights", this.weights);
    // console.log("patterns", this.patterns);

    function agrees(pattern1: number[], pattern2: number[], dx: number, dy: number): boolean {
      const xMin = dx < 0 ? 0 : dx;
      const xMax = dx < 0 ? dx + N : N;
      const yMin = dy < 0 ? 0 : dy;
      const yMax = dy < 0 ? dy + N : N;
      for (let y = yMin; y < yMax; y++) {
        for (let x = xMin; x < xMax; x++) {
          if (pattern1[x + N * y] != pattern2[x - dx + N * (y - dy)]) {
            return false;
          }
        }
      }
      return true;
    }

    this.propagator = [];
    for (let direction = 0; direction < 4; direction++) {
      this.propagator[direction] = [];
      for (let pattern1 = 0; pattern1 < this.T; pattern1++) {
        this.propagator[direction][pattern1] = [];
        for (let pattern2 = 0; pattern2 < this.T; pattern2++) {
          if (agrees(this.patterns[pattern1], this.patterns[pattern2], Model.DX[direction], Model.DY[direction])) {
            this.propagator[direction][pattern1].push(pattern2);
          }
        }
      }
    }
  }

  protected testObserved(i: number): void {
    const x = i % this.FMX, y = Math.floor(i / this.FMX);

    // test 1
    if (!this.onBoundary(x, y)) {
      const patterns = this.wave[i].filter(v => v).length;
      console.assert(patterns === 1, `wave ${i} pattern count ${patterns}`);
    }

    // test 2
    let contributors = 0;
    const tileSet = new Set<number>();
    for (let dy = 0; dy < this.N; dy++) {
      for (let dx = 0; dx < this.N; dx++) {
        let sx = x - dx, sy = y - dy;
        if (this.onBoundary(sx, sy)) {
          continue;
        }

        if (sx < 0) sx += this.FMX;
        else if (sx >= this.FMX) sx -= this.FMX;
        if (sy < 0) sy += this.FMY;
        else if (sy >= this.FMY) sy -= this.FMY;

        const s = sx + sy * this.FMX;

        for (let t = 0; t < this.T; t++) {
          if (this.wave[s][t]) {
            contributors++;
            const tileId = this.patterns[t][dx + dy * this.N];
            tileSet.add(tileId);
          }
        }
      }
    }
    console.assert(tileSet.size === 1,
      "wave", i,
      "contributors", contributors,
      "tiles", tileSet.size,
      "sumsOfOnes", this.sumsOfOnes[i],
      "sumsOfWeights", this.sumsOfWeights[i],
      "sumsOfWeightLogWeights", this.sumsOfWeightLogWeights[i],
      "entropies", this.entropies[i],
    );
  }

  initConstraint(): void {
    for (const constraint of this._constraints) {
      constraint.init(this);
      if (this.status != Resolution.Undecided) {
        if (this.debug) console.warn("failed init constraint", this.status);
        return;
      }
    }
  }

  stepConstraint(): void {
    for (const constraint of this._constraints) {
      constraint.check();
      if (this.status != Resolution.Undecided) {
        if (this.debug) console.warn("failed step constraint check");
        return;
      }
      this.propagate();
      if (this.status != Resolution.Undecided) {
        if (this.debug) console.warn("failed step constraint propagate");
        return;
      }
    }
    this.deferredConstraintsStep = false;
  }

  backtrackConstraint(index: number, pattern: number): void {
    for (const constraint of this._constraints) {
      constraint.onBacktrack(index, pattern);
    }
  }

  banConstraint(index: number, pattern: number): void {
    for (const constraint of this._constraints) {
      constraint.onBan(index, pattern);
    }
  }

  onBoundary(x: number, y: number): boolean {
    return !this.periodic && (x + this.N > this.FMX || y + this.N > this.FMY || x < 0 || y < 0);
  }

  clear(): void {
    super.clear();
    if (this.ground != 0) {
      for (let x = 0; x < this.FMX; x++) {
        for (let t = 0; t < this.T; t++) {
          if (t != this.ground) {
            if (this.internalBan(x + (this.FMY - 1) * this.FMX, t)) {
              this.status = Resolution.Contradiction;
              return;
            }
          }
        }
        for (let y = 0; y < this.FMY - 1; y++) {
          if (this.internalBan(x + y * this.FMX, this.ground)) {
            this.status = Resolution.Contradiction;
            return;
          }
        }
      }
      this.propagate();
    }
    for (const constraint of this._constraints) {
      constraint.onClear();
      this.propagate();
    }
  }

  graphics(markup: number[]): void {
    const bitmap = new Uint8Array(4 * this.FMX * this.FMY);
    if (this.observed != null) {
      for (let y = 0; y < this.FMY; y++) {
        const dy = y < this.FMY - this.N + 1 ? 0 : this.N - 1;

        for (let x = 0; x < this.FMX; x++) {
          const dx = x < this.FMX - this.N + 1 ? 0 : this.N - 1;

          const index = x - dx + (y - dy) * this.FMX;
          const patternIndex = this.observed[index];
          const pattern = this.patterns[patternIndex];
          const tileIndex = pattern[dx + dy * this.N];
          const tile = this.tiles[tileIndex];
          const c = tile.color;
          const offset = 4 * (x + y * this.FMX);
          bitmap[offset] = c.R;
          bitmap[offset + 1] = c.G;
          bitmap[offset + 2] = c.B;
          bitmap[offset + 3] = c.A;
        }
      }
    } else {
      for (let i = 0; i < this.wave.length; i++) {
        let contributors = 0, r = 0, g = 0, b = 0, a = 0;
        const x = i % this.FMX, y = Math.floor(i / this.FMX);

        for (let dy = 0; dy < this.N; dy++) {
          for (let dx = 0; dx < this.N; dx++) {
            let sx = x - dx, sy = y - dy;
            if (this.onBoundary(sx, sy)) {
              continue;
            }

            if (sx < 0) sx += this.FMX;
            else if (sx >= this.FMX) sx -= this.FMX;
            if (sy < 0) sy += this.FMY;
            else if (sy >= this.FMY) sy -= this.FMY;

            const s = sx + sy * this.FMX;

            for (let t = 0; t < this.T; t++) {
              if (this.wave[s][t]) {
                contributors++;
                const color = this.tiles[this.patterns[t][dx + dy * this.N]].color;
                r += color.R;
                g += color.G;
                b += color.B;
                a += color.A;
              }
            }
          }
        }

        bitmap[i * 4] = Math.floor(r / contributors);
        bitmap[i * 4 + 1] = Math.floor(g / contributors);
        bitmap[i * 4 + 2] = Math.floor(b / contributors);
        bitmap[i * 4 + 3] = Math.floor(a / contributors);
      }
    }

    const scale = 10;
    const canvas = document.createElement("canvas");
    canvas.width = this.FMX * scale;
    canvas.height = this.FMY * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.strokeStyle = "grey";
    for (let i = 0, j = 0; j < bitmap.length; i++, j += 4) {
      ctx.fillStyle = `rgb(${bitmap[j]},${bitmap[j + 1]},${bitmap[j + 2]})`;
      const x = i % this.FMX, y = Math.floor(i / this.FMX);
      ctx.fillRect(x * scale, y * scale, scale, scale);
      ctx.strokeRect(x * scale, y * scale, scale, scale);
    }

    ctx.strokeStyle = "red";
    for (const i of markup) {
      const x = i % this.FMX, y = Math.floor(i / this.FMX);
      ctx.strokeRect(x * scale, y * scale, scale, scale);
    }
    console.log('%c ', `
      font-size: 1px;
      padding: ${canvas.height / 2}px ${canvas.width / 2}px;
      background: no-repeat url(${canvas.toDataURL('image/png')});
      background-size: ${canvas.width}px ${canvas.height}px;
    `);
  }
}

// origin https://github.com/BorisTheBrave/DeBroglie/

export interface Constraint<T> {
  init(model: OverlappingModel<T>): void;
  onClear(): void;
  onBan(index: number, pattern: number): void;
  onBacktrack(index: number, pattern: number): void;
  check(): void;
}

export class PathConstraint<T> implements Constraint<T> {
  private readonly _pathTiles: Tile<T>[];
  private _isPathTile: boolean[] = [];

  private _model: OverlappingModel<T> | null = null;
  private _graph: SimpleGraph | null = null;
  private _couldBePath: boolean[] = [];
  private _mustBePath: boolean[] = [];

  private _refresh: boolean[] = [];
  private _refreshQueue: number[] = [];

  constructor(pathTiles: Tile<T>[]) {
    this._pathTiles = pathTiles;
  }

  init(model: OverlappingModel<T>): void {
    this._model = model;
    const indices = model.FMX * model.FMY;
    this._isPathTile = buffer(indices, false);
    for (const pathTile of this._pathTiles) {
      const index = model.tiles.findIndex(m => m.equals(pathTile));
      this._isPathTile[index] = true;
    }

    this._couldBePath = buffer(indices, false);
    this._mustBePath = buffer(indices, false);
    this._refresh = buffer(indices, true);
    this._refreshQueue = [];
  }

  onClear(): void {
    const indices = this._model!.FMX * this._model!.FMY;
    this._couldBePath = buffer(indices, false);
    this._mustBePath = buffer(indices, false);
    this._refresh = buffer(indices, true);
    this._refreshQueue = [];
    for (let i = 0; i < indices; i++) {
      this._refreshQueue.push(i);
    }
    this.refreshAll();

    this._graph = this.createGraph();
  }

  onBan(index: number, _patternIndex: number): void {
    this.addRefresh(index);
  }

  onBacktrack(index: number, _patternIndex: number): void {
    this.addRefresh(index);
  }

  private addRefresh(index: number): void {
    if (!this._refresh[index]) {

      const FMX = this._model!.FMX;
      const FMY = this._model!.FMY;
      const x = index % FMX, y = Math.floor(index / FMX);

      this._refresh[index] = true;
      this._refreshQueue.push(index);

      for (let direction = 0; direction < 4; direction++) {
        const dx = Model.DX[direction], dy = Model.DY[direction];
        let sx = x + dx, sy = y + dy;
        if (this._model!.onBoundary(sx, sy)) {
          continue;
        }

        if (sx < 0) sx += FMX;
        else if (sx >= FMX) sx -= FMX;
        if (sy < 0) sy += FMY;
        else if (sy >= FMY) sy -= FMY;

        const s = sx + sy * FMX;

        if (!this._refresh[s]) {
          this._refresh[s] = true;
          this._refreshQueue.push(s);
        }
      }
    }
  }

  private refreshAll(): void {
    const model = this._model!;
    const FMX = model.FMX;
    const FMY = model.FMY;
    const N = model.N;
    const T = model.T;

    while (this._refreshQueue.length > 0) {
      const i = this._refreshQueue.pop()!;
      this._refresh[i] = false;

      const x = i % FMX, y = Math.floor(i / FMX);

      let pathCount = 0;
      let totalCount = 0;

      for (let dy = 0; dy < N; dy++) {
        for (let dx = 0; dx < N; dx++) {
          let sx = x - dx, sy = y - dy;
          if (model.onBoundary(sx, sy)) {
            continue;
          }

          if (sx < 0) sx += FMX;
          else if (sx >= FMX) sx -= FMX;
          if (sy < 0) sy += FMY;
          else if (sy >= FMY) sy -= FMY;

          const s = sx + sy * FMX;

          for (let t = 0; t < T; t++) {
            if (model.wave[s][t]) {
              totalCount++;
              const index = model.patterns[t][dx + dy * N];
              if (this._isPathTile[index]) {
                pathCount++;
              }
            }
          }
        }
      }

      this._couldBePath[i] = pathCount > 0;
      this._mustBePath[i] = pathCount > 0 && totalCount === pathCount;
    }
  }

  check(): void {
    for (; ;) {
      this.refreshAll();

      const isArticulation = this.getArticulationPoints();
      if (isArticulation == null) {
        if (this._model!.debug) console.error("no articulation");
        this._model!.status = Resolution.Contradiction;
        return;
      }

      if (this.applyArticulationPoints(isArticulation)) {
        if (this._model!.debug) {
          console.log("articulation");
          const markup: number[] = isArticulation
            .map<[boolean, number]>((v, i) => [v, i])
            .filter(a => a[0])
            .map(a => a[1]);
          this._model!.graphics(markup);
          console.log("continue articulation loop");
        }
      } else {
        break;
      }
    }
  }

  private applyArticulationPoints(isArticulation: boolean[]): boolean {
    const model = this._model!;
    const FMX = model.FMX;
    const FMY = model.FMY;
    const indices = FMX * FMY;
    // All articulation points must be paths,
    // So ban any other possibilities
    let changed = false;
    for (let i = 0; i < indices; i++) {
      if (isArticulation[i] && !this._mustBePath[i]) {
        if (model.debug) console.log("articulation", i);
        const x = i % model.FMX, y = Math.floor(i / model.FMX);
        if (model.debug) console.log("x, y, i", x, y, i);
        for (let dy = 0; dy < model.N; dy++) {
          for (let dx = 0; dx < model.N; dx++) {
            let sx = x - dx;
            if (sx < 0) sx += model.FMX;

            let sy = y - dy;
            if (sy < 0) sy += model.FMY;

            const s = sx + sy * model.FMX;
            if (model.onBoundary(sx, sy)) {
              continue;
            }
            for (let t = 0; t < model.T; t++) {
              if (model.wave[s][t]) {
                const index = model.patterns[t][dx + dy * model.N];
                if (this._isPathTile[index]) {
                  if (model.debug) console.log("ban not path", index, t, model.patterns[t]);
                  model.ban(s, t);
                  changed = true;
                }
              }
            }
          }
        }
      }
    }
    return changed;
  }

  private getArticulationPoints(): boolean[] | null {
    const walkable = this._couldBePath;
    const relevant = this._mustBePath;

    const model = this._model!;
    const graph = this._graph!;
    const indices = walkable.length;

    const low: number[] = buffer(indices, 0);
    let num = 1;
    const dfsNum: number[] = buffer(indices, 0);
    const markup: number[] = [];
    const isArticulation: boolean[] = buffer(indices, false);

    // This hideous function is a iterative version
    // of the much more elegant recursive version below.
    // Unfortunately, the recursive version tends to blow the stack for large graphs
    function cutVertex(initialU: number): number {
      const stack: CutVertexFrame[] = [];
      stack.push(new CutVertexFrame(initialU));

      // This is the "returned" value from recursion
      let childRelevantSubtree: boolean = false;
      let childCount = 0;

      for (; ;) {
        const frameIndex = stack.length - 1;
        const frame = stack[frameIndex];
        const u = frame.u;

        let switchState = frame.state;
        let loop: boolean;
        do {
          loop = false;
          // console.log("switchState", switchState);
          switch (switchState) {
            // Initialization
            case 0: {
              // console.log("switch 0");
              const isRelevant = relevant != null && relevant[u];
              if (isRelevant) {
                isArticulation[u] = true;
              }
              frame.isRelevantSubtree = isRelevant;
              low[u] = dfsNum[u] = num++;
              markup.push(u);
              // Enter loop
              switchState = 1;
              loop = true;
              break;
            }
            // Loop over neighbours
            case 1: {
              // console.log("switch 1");
              // Check loop condition
              const neighbours = graph.neighbours[u];
              const neighbourIndex = frame.neighbourIndex;
              if (neighbourIndex >= neighbours.length) {
                // Exit loop
                switchState = 3;
                loop = true;
                break;
              }
              const v = neighbours[neighbourIndex];
              if (!walkable[v]) {
                // continue to next iteration of loop
                frame.neighbourIndex = neighbourIndex + 1;
                switchState = 1;
                loop = true;
                break;
              }

              // v is a neighbour of u
              const unvisited = dfsNum[v] === 0;
              if (unvisited) {
                // Recurse into v
                stack.push(new CutVertexFrame(v));
                frame.state = 2;
                switchState = 2;
                stack[frameIndex] = frame;
                break;
              } else {
                low[u] = Math.min(low[u], dfsNum[v]);
              }

              // continue to next iteration of loop
              frame.neighbourIndex = neighbourIndex + 1;
              switchState = 1;
              loop = true;
              break;
            }
            // Return from recursion (still in loop)
            case 2: {
              // console.log("switch 2");
              // At this point, childRelevantSubtree
              // has been set to the by the recursion call we've just returned from
              const neighbours = graph.neighbours[u];
              const neighbourIndex = frame.neighbourIndex;
              const v = neighbours[neighbourIndex];

              if (frameIndex == 0) {
                // Root frame
                childCount++;
              }

              if (childRelevantSubtree) {
                frame.isRelevantSubtree = true;
              }
              if (low[v] >= dfsNum[u]) {
                if (relevant == null || childRelevantSubtree) {
                  isArticulation[u] = true;
                }
              }
              low[u] = Math.min(low[u], low[v]);

              // continue to next iteration of loop
              frame.neighbourIndex = neighbourIndex + 1;
              switchState = 1;
              loop = true;
              break;
            }
            // Cleanup
            case 3: {
              // console.log("switch 3");
              if (frameIndex == 0) {
                // Root frame
                return childCount;
              } else {
                // Set childRelevantSubtree with the return value from this recursion call
                childRelevantSubtree = frame.isRelevantSubtree;
                // Pop the frame
                stack.splice(frameIndex, 1);
                // Resume the caller (which will be in state 2)
                break;
              }
            }
          }
        } while (loop);
      }
    }

    // Check we've visited every relevant point.
    // If not, there's no way to satisfy the constraint.
    // UPD relevant always not null
    // Find starting point
    for (let i = 0; i < indices; i++) {
      if (!walkable[i]) continue;
      if (!relevant[i]) continue;
      // Already visited
      if (dfsNum[i] != 0) continue;

      cutVertex(i);
      // Relevant points are always articulation points
      // UPD: relevant == must be path, already articulated
      // isArticulation[i] = true;
      break;
    }

    // Check connectivity
    for (let i = 0; i < indices; i++) {
      if (relevant[i] && dfsNum[i] == 0) {
        if (model.debug) {
          console.warn("walkable:");
          const markupW: number[] = walkable
            .map<[boolean, number]>((v, i) => [v, i])
            .filter(a => a[0])
            .map(a => a[1]);
          model.graphics(markupW);
          console.warn("visited");
          model.graphics(markup);

          const w = model.FMX;
          const x = i % w, y = Math.floor(i / w);
          console.error(`not visited relevant point i=${i} x=${x} y=${y}`);
          console.warn('graph neighbours', graph.neighbours[i]);
          model.graphics([i]);
        }
        return null;
      }
    }

    // compute articulation points
    for (let i = 0; i < indices; i++) {
      if (!walkable[i]) continue;
      if (relevant[i]) continue; // graph is already connected with all relevant points
      if (dfsNum[i] != 0) continue; // Already visited
      if (isArticulation[i]) continue; // if point is already articulation point, it visited

      // console.warn("compute articulation point for ", i);

      const childCount = cutVertex(i);
      // The root of the tree is an exception to CutVertex's calculations
      // It's an articulation point if it has multiple children
      // as removing it would give multiple subtrees.
      isArticulation[i] = childCount > 1;
    }

    return isArticulation;
  }

  private createGraph(): SimpleGraph {
    const model = this._model!;
    const nodeCount = model.FMX * model.FMY;
    const neighbours: number[][] = [];
    for (let i = 0; i < nodeCount; i++) {
      neighbours[i] = [];

      const x = i % model.FMX, y = Math.floor(i / model.FMX);

      for (let direction = 0; direction < 4; direction++) {
        const dx = Model.DX[direction], dy = Model.DY[direction];
        let sx = x + dx, sy = y + dy;
        if (!model.periodic && (sx >= model.FMX || sy >= model.FMY || sx < 0 || sy < 0)) {
          continue;
        }

        if (sx < 0) sx += model.FMX;
        else if (sx >= model.FMX) sx -= model.FMX;
        if (sy < 0) sy += model.FMY;
        else if (sy >= model.FMY) sy -= model.FMY;

        const s = sx + sy * model.FMX;

        neighbours[i].push(s);
      }
    }

    return {
      nodeCount: nodeCount,
      neighbours: neighbours,
    };
  }
}

export class BorderConstraint<T> implements Constraint<T> {
  private readonly _borderTile: Tile<T>;
  private _model: OverlappingModel<T> | null = null;

  constructor(borderTile: Tile<T>) {
    this._borderTile = borderTile;
  }

  init(model: OverlappingModel<T>): void {
    this._model = model;
  }

  onClear(): void {
    const model = this._model!;
    const indices = model.FMX * model.FMY;
    const borderTileIndex = model.tiles.findIndex(c => this._borderTile.equals(c));

    for (let i = 0; i < indices; i++) {
      const x = i % model.FMX, y = Math.floor(i / model.FMX);
      if (x === 0 || x === model.FMX - 1 || y === 0 || y === model.FMY - 1) {
        for (let dy = 0; dy < model.N; dy++) {
          for (let dx = 0; dx < model.N; dx++) {
            let sx = x - dx;
            if (sx < 0) sx += model.FMX;

            let sy = y - dy;
            if (sy < 0) sy += model.FMY;

            const s = sx + sy * model.FMX;
            if (model.onBoundary(sx, sy)) {
              continue;
            }
            for (let t = 0; t < model.T; t++) {
              if (model.wave[s][t]) {
                const colorIndex = model.patterns[t][dx + dy * model.N];
                if (colorIndex !== borderTileIndex) {
                  model.ban(s, t);
                }
              }
            }
          }
        }
      }
    }
  }

  onBan(_index: number, _pattern: number): void {
  }

  onBacktrack(_index: number, _pattern: number): void {
  }

  check(): boolean {
    return true;
  }
}

class CutVertexFrame {
  u: number;
  state: number = 0;
  neighbourIndex: number = 0;
  isRelevantSubtree: boolean = false;

  constructor(u: number) {
    this.u = u;
  }
}

interface SimpleGraph {
  readonly nodeCount: number;
  readonly neighbours: number[][];
}

export class TestOverlappingModel {
  static async test(): Promise<void> {
    await this.test1();
  }

  static async test1(): Promise<void> {
    const N: number = 3,
      width: number = 10,
      height: number = 10,
      periodicInput = false,
      periodicOutput = false,
      symmetry: number = 8,
      ground: number = 0;

    const wC = new Color(255, 255, 255, 255);
    const rC = new Color(255, 0, 0, 255);

    const w = new Tile(wC, wC, (a, b) => a.equals(b));
    const r = new Tile(rC, rC, (a, b) => a.equals(b));

    const sample: Tile<Color>[][] = [
      [w, w, r, w, w],
      [w, w, r, w, w],
      [r, r, r, r, r],
      [w, w, r, w, w],
      [w, w, r, w, w],
    ];

    const model = new OverlappingModel(sample, N, RNG.create(), width, height, periodicInput, periodicOutput, symmetry, ground, []);
    if (await model.run() !== Resolution.Decided) {
      console.log("fail");
    } else {
      console.log("success");
    }
    console.log("model", model);
    model.graphics([]);
  }

  static async test2(): Promise<void> {
    const N: number = 3,
      width: number = 30,
      height: number = 30,
      periodicInput = false,
      periodicOutput = false,
      symmetry: number = 1,
      ground: number = 0;

    const wC = new Color(255, 255, 255, 255);
    const rC = new Color(255, 0, 0, 255);
    const bC = new Color(0, 0, 0, 255);

    const w = new Tile(wC, wC, (a, b) => a.equals(b));
    const r = new Tile(rC, rC, (a, b) => a.equals(b));
    const b = new Tile(bC, bC, (a, b) => a.equals(b));

    const sample: Tile<Color>[][] = [
      [w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w],
      [w, b, b, b, b, b, b, b, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, w],
      [w, b, r, r, r, r, r, b, w, w, w, w, w, w, w, w, w, b, r, r, r, r, r, b, w],
      [w, b, r, r, r, r, r, b, b, b, b, b, b, b, b, b, b, b, r, r, r, r, r, b, w],
      [w, b, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, b, w],
      [w, b, r, r, r, r, r, b, b, b, b, r, r, b, b, b, b, b, r, r, r, r, r, b, w],
      [w, b, r, r, r, r, r, b, w, w, b, r, r, b, w, w, w, b, r, r, r, r, r, b, w],
      [w, b, r, r, r, r, r, b, w, w, b, r, r, b, w, w, w, b, r, r, r, r, r, b, w],
      [w, b, b, b, r, b, b, b, w, w, b, r, r, b, w, w, w, b, b, b, r, b, b, b, w],
      [w, w, w, b, r, b, w, w, w, w, b, r, r, b, w, w, w, w, w, b, r, b, w, w, w],
      [w, w, w, b, r, b, w, w, w, w, b, r, r, b, w, w, w, w, w, b, r, b, w, w, w],
      [w, w, w, b, r, b, b, b, b, b, b, r, r, b, b, b, b, b, b, b, r, b, w, w, w],
      [w, w, w, b, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, b, w, w, w],
      [w, w, w, b, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, b, w, w, w],
      [w, w, w, b, b, b, b, b, b, b, b, r, b, b, b, b, b, b, b, b, r, b, w, w, w],
      [w, w, w, w, w, w, w, w, w, w, b, r, b, w, w, w, w, w, w, b, r, b, w, w, w],
      [w, w, w, w, w, w, w, w, w, w, b, r, b, w, w, w, w, b, b, b, r, b, w, w, w],
      [w, w, w, w, w, w, w, w, w, w, b, r, b, w, w, w, w, b, r, r, r, b, w, w, w],
      [w, w, w, w, w, w, w, w, w, w, b, r, b, w, w, w, w, b, r, b, b, b, w, w, w],
      [w, b, b, b, b, b, b, b, w, w, b, r, b, w, w, w, w, b, r, b, w, w, w, w, w],
      [w, b, r, r, r, r, r, b, w, w, b, r, b, w, w, w, w, b, r, b, w, w, w, w, w],
      [w, b, r, r, r, r, r, b, b, b, b, r, b, b, b, b, b, b, r, b, w, w, w, w, w],
      [w, b, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, b, w, w, w, w, w],
      [w, b, r, r, r, r, r, b, b, b, b, b, b, b, b, b, b, b, b, b, w, w, w, w, w],
      [w, b, r, r, r, r, r, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w],
      [w, b, b, b, b, b, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w],
      [w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w],
    ];

    const border = new BorderConstraint(w);
    const path = new PathConstraint([r]);
    const model = new OverlappingModel(sample, N, RNG.create(), width, height, periodicInput, periodicOutput, symmetry, ground, [border, path]);
    if (await model.run() !== Resolution.Decided) {
      console.log("fail");
    } else {
      console.log("success");
    }
    console.log("model", model);
    model.graphics([]);
  }
}