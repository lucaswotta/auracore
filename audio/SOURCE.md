# Áudios ambiente

`rain.webm` e `underwater.webm` foram gerados por IA no Gemini (modelo de música Lyria, do Google) em 24/10/2026, a partir de descrições em texto, sem áudio de referência. Os termos do Google não reivindicam propriedade sobre conteúdo gerado. O áudio carrega a marca d'água inaudível SynthID.

Descrições usadas:

- Chuva: "Seamless ambient recording of heavy steady rain heard from indoors, dark and warm, most of the energy below 500 Hz, soft high end with no hiss or crackle, dense continuous rainfall without individual drops standing out, occasional distant rolling thunder very low in the mix. No music, no voices, no birds, no traffic. 60 seconds."
- Água: "Underwater ambience as heard by someone submerged in a calm lake, deep muffled low rumble, smooth and continuous, very few bubbles, no sharp clicks, almost nothing above 1 kHz. No music, no voices, no boat engines. 60 seconds."

A chuva usa 45 s a partir de 8 s da geração, igualizada para soar escura (graves +9 dB em 90 Hz e agudos -3 dB a partir de 1,5 kHz). A água usa 50 s a partir de 8 s, sem igualização. Os trechos foram escolhidos para que o volume no início e no fim do loop seja parecido. Ambos passam por passa-alta em 20 Hz, viram mono e têm as pontas sobrepostas em 2 s com crossfade de potência constante. A loudness foi igualada à dos loops com que a mistura do motor foi calibrada de ouvido (-28,3 LUFS na chuva e -24,5 LUFS na água), com limitador em -2 dBFS. Com os ganhos padrão do motor, a chuva fica perto de -25 LUFS e a água perto de -28 LUFS, de 11 a 14 LU abaixo de música normalizada em -14 LUFS.

Cada arquivo traz 50 ms de sobra em cada ponta (o fim do loop antes do início e o início depois do fim), que o motor usa para emendar o loop sem estalo; ver `smoothLoopSeam` em `engine.js`. Os arquivos usam Opus mono a 48 kb/s e carregam apenas quando o efeito correspondente é usado.
