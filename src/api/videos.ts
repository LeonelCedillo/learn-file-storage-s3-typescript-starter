import path from "path";
import { rm } from "fs/promises";
import { uploadVideoToS3 } from "../s3";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30; // 1GB
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId); // video metadata
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }
  
  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File exceeds the size limit (1GB)");
  }
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Invalid file type, only MP4 allowed.");
  }
  
  const key = `${videoId}.mp4`;
  const tempFilePath = path.join("/tmp", key)

  await Bun.write(tempFilePath, file);

  await uploadVideoToS3(cfg, key, tempFilePath, file.type); 

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Promise.all([rm(tempFilePath, { force: true })]);
  
  return respondWithJSON(200, video);
}
