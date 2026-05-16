import sys

import av


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: encode_opus.py input.wav output.ogg", file=sys.stderr)
        return 2

    input_path, output_path = sys.argv[1], sys.argv[2]
    input_container = av.open(input_path)
    output_container = av.open(output_path, "w", format="ogg")
    stream = output_container.add_stream("libopus", rate=16000)
    stream.bit_rate = 16000
    stream.layout = "mono"
    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)

    try:
        for packet in input_container.demux(audio=0):
            for frame in packet.decode():
                frames = resampler.resample(frame)
                if not isinstance(frames, list):
                    frames = [frames]
                for resampled in frames:
                    for encoded in stream.encode(resampled):
                        output_container.mux(encoded)

        for encoded in stream.encode(None):
            output_container.mux(encoded)
    finally:
        output_container.close()
        input_container.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
