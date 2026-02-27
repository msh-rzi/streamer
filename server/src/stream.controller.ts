// stream.controller.ts
import { Controller, Get, Req, Res } from '@nestjs/common';
import { createReadStream, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import type { Request, Response } from 'express';

@Controller('video')
export class StreamController {
  @Get()
  stream(@Req() req: Request, @Res() res: Response) {
    const videoPath = process.env.VIDEO_PATH ?? 'video.mp4';
    const resolvedVideoPath = isAbsolute(videoPath)
      ? videoPath
      : resolve(process.cwd(), videoPath);

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(resolvedVideoPath);
    } catch {
      res.status(404).send('Video file not found.');
      return;
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
    };

    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
      });

      createReadStream(resolvedVideoPath).pipe(res);
      return;
    }

    if (!range.startsWith('bytes=')) {
      res.setHeader(
        'Access-Control-Allow-Origin',
        corsHeaders['Access-Control-Allow-Origin'],
      );
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }

    const [startStr, endStr] = range.replace('bytes=', '').split('-');
    let start = Number.parseInt(startStr, 10);
    let end = Number.parseInt(endStr, 10);

    if (Number.isNaN(start)) {
      // Suffix range: "bytes=-500"
      const suffixLength = Number.parseInt(endStr, 10);
      if (Number.isNaN(suffixLength)) {
        res.setHeader(
          'Access-Control-Allow-Origin',
          corsHeaders['Access-Control-Allow-Origin'],
        );
        res
          .status(416)
          .setHeader('Content-Range', `bytes */${stat.size}`)
          .end();
        return;
      }

      start = Math.max(stat.size - suffixLength, 0);
      end = stat.size - 1;
    } else {
      if (Number.isNaN(end)) end = stat.size - 1;
    }

    if (start < 0 || end >= stat.size || start > end) {
      res.setHeader(
        'Access-Control-Allow-Origin',
        corsHeaders['Access-Control-Allow-Origin'],
      );
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      ...corsHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });

    createReadStream(resolvedVideoPath, { start, end }).pipe(res);
  }
}
