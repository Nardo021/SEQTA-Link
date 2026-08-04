import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export type Prompt = {
  question: (text: string) => Promise<string>;
  questionHidden: (text: string) => Promise<string>;
  close: () => void;
};

export function createPrompt(): Prompt {
  const rl = createInterface({ input, output, terminal: true });

  return {
    async question(text: string): Promise<string> {
      const answer = await rl.question(text);
      return answer.trim();
    },

    async questionHidden(text: string): Promise<string> {
      if (!input.isTTY || typeof input.setRawMode !== 'function') {
        const answer = await rl.question(`${text} (输入可见) `);
        return answer.trim();
      }

      rl.pause();
      output.write(text);
      const chars: string[] = [];
      return new Promise((resolve, reject) => {
        const wasRaw = Boolean((input as NodeJS.ReadStream & { isRaw?: boolean }).isRaw);
        input.setRawMode(true);
        input.resume();

        const onData = (buf: Buffer) => {
          const s = buf.toString('utf8');
          for (const ch of s) {
            if (ch === '\n' || ch === '\r' || ch === '\u0004') {
              cleanup();
              output.write('\n');
              rl.resume();
              resolve(chars.join('').trim());
              return;
            }
            if (ch === '\u0003') {
              cleanup();
              output.write('\n');
              rl.resume();
              reject(new Error('Cancelled'));
              return;
            }
            if (ch === '\u007f' || ch === '\b') {
              if (chars.length > 0) {
                chars.pop();
                output.write('\b \b');
              }
              continue;
            }
            if (ch >= ' ') {
              chars.push(ch);
              output.write('*');
            }
          }
        };

        const cleanup = () => {
          input.off('data', onData);
          input.setRawMode(wasRaw);
        };

        input.on('data', onData);
      });
    },

    close() {
      rl.close();
    },
  };
}

export async function confirmYesNo(prompt: Prompt, message: string): Promise<boolean> {
  for (;;) {
    const answer = (await prompt.question(`${message} [yes/no] `)).toLowerCase();
    if (answer === 'yes' || answer === 'y') {
      return true;
    }
    if (answer === 'no' || answer === 'n') {
      return false;
    }
    console.log('请输入 yes 或 no。');
  }
}
