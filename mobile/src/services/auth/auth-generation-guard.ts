export class AuthGenerationGuard {
  private generation = 0;

  advance(): void {
    this.generation += 1;
  }

  capture(): () => boolean {
    const capturedGeneration = this.generation;
    return () => {
      if (capturedGeneration !== this.generation) return false;
      this.advance();
      return true;
    };
  }
}
