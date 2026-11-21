import AVFoundation
import ExpoModulesCore
import ImageIO
import UIKit
import UniformTypeIdentifiers

internal final class MediaToolsException: GenericException<String> {
  override var reason: String {
    param
  }
}

internal struct ConvertOptions: Record {
  /// "mp4", "mov", "m4a" or "gif"
  @Field var output: String = "mp4"
  /// Short side of the output video in pixels (720 means 720p). 0 keeps the original size.
  @Field var maxHeight: Int = 0
  /// Trim start and end in seconds. 0 means "from the beginning" / "to the end".
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var mute: Bool = false
  @Field var gifFps: Double = 12
  /// Longest side of the GIF in pixels.
  @Field var gifSize: Double = 480
  @Field var jobId: String = ""
}

public class MediaToolsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaTools")

    Events("onProgress")

    AsyncFunction("probe") { (uri: URL) async throws -> [String: Any] in
      let asset = AVURLAsset(url: uri)
      let duration = try await asset.load(.duration).seconds
      let videoTracks = try await asset.loadTracks(withMediaType: .video)
      let audioTracks = try await asset.loadTracks(withMediaType: .audio)
      var width = 0.0
      var height = 0.0
      if let video = videoTracks.first {
        let size = try await Self.orientedSize(of: video)
        width = Double(size.width)
        height = Double(size.height)
      }
      return [
        "duration": duration.isFinite ? duration : 0,
        "hasVideo": !videoTracks.isEmpty,
        "hasAudio": !audioTracks.isEmpty,
        "width": width,
        "height": height,
      ]
    }

    // Joins a video-only file and an audio-only file (YouTube HD) without re-encoding.
    AsyncFunction("merge") { (videoUri: URL, audioUri: URL, outputUri: URL, jobId: String) async throws -> String in
      let videoAsset = AVURLAsset(url: videoUri)
      let audioAsset = AVURLAsset(url: audioUri)
      guard let videoTrack = try await videoAsset.loadTracks(withMediaType: .video).first else {
        throw MediaToolsException("The downloaded video has no picture.")
      }
      let audioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first
      let videoRange = try await videoTrack.load(.timeRange)
      let videoDuration = videoRange.duration

      let composition = AVMutableComposition()
      guard let compVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw MediaToolsException("Couldn't prepare the video.")
      }
      try compVideo.insertTimeRange(videoRange, of: videoTrack, at: .zero)
      compVideo.preferredTransform = try await videoTrack.load(.preferredTransform)

      if let audioTrack {
        let audioRange = try await audioTrack.load(.timeRange)
        let range = CMTimeRangeGetIntersection(audioRange, otherRange: CMTimeRange(start: .zero, duration: videoDuration))
        if let compAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
           range.duration > .zero {
          try compAudio.insertTimeRange(range, of: audioTrack, at: .zero)
        }
      }

      guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
        throw MediaToolsException("Couldn't prepare the video.")
      }
      session.outputURL = outputUri
      session.outputFileType = session.supportedFileTypes.contains(.mp4) ? .mp4 : .mov
      session.shouldOptimizeForNetworkUse = true
      try await self.run(session, to: outputUri, jobId: jobId)
      return outputUri.absoluteString
    }

    AsyncFunction("convert") { (inputUri: URL, outputUri: URL, options: ConvertOptions) async throws -> String in
      let asset = AVURLAsset(url: inputUri)
      let videoTracks = try await asset.loadTracks(withMediaType: .video)
      let audioTracks = try await asset.loadTracks(withMediaType: .audio)
      let duration = try await asset.load(.duration)
      let range = Self.trimRange(start: options.start, end: options.end, duration: duration)

      switch options.output {
      case "gif":
        guard !videoTracks.isEmpty else {
          throw MediaToolsException("This file has sound but no picture, so it can't become a GIF.")
        }
        return try await self.makeGif(asset: asset, range: range, options: options, outputUri: outputUri)

      case "m4a":
        guard !audioTracks.isEmpty else {
          throw MediaToolsException("This file has no sound to save.")
        }
        let composition = AVMutableComposition()
        for track in audioTracks.prefix(1) {
          let trackRange = CMTimeRangeGetIntersection(range, otherRange: try await track.load(.timeRange))
          if let compAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
             trackRange.duration > .zero {
            try compAudio.insertTimeRange(trackRange, of: track, at: .zero)
          }
        }
        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
          throw MediaToolsException("Couldn't prepare the audio.")
        }
        session.outputURL = outputUri
        session.outputFileType = .m4a
        try await self.run(session, to: outputUri, jobId: options.jobId)
        return outputUri.absoluteString

      default:
        guard let videoTrack = videoTracks.first else {
          throw MediaToolsException("This file has sound but no picture. Choose Audio instead.")
        }
        let composition = AVMutableComposition()
        guard let compVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
          throw MediaToolsException("Couldn't prepare the video.")
        }
        let videoRange = CMTimeRangeGetIntersection(range, otherRange: try await videoTrack.load(.timeRange))
        try compVideo.insertTimeRange(videoRange, of: videoTrack, at: .zero)

        if !options.mute, let audioTrack = audioTracks.first {
          let audioRange = CMTimeRangeGetIntersection(range, otherRange: try await audioTrack.load(.timeRange))
          if let compAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
             audioRange.duration > .zero {
            try compAudio.insertTimeRange(audioRange, of: audioTrack, at: .zero)
          }
        }

        let transform = try await videoTrack.load(.preferredTransform)
        let naturalSize = try await videoTrack.load(.naturalSize)
        let oriented = CGRect(origin: .zero, size: naturalSize).applying(transform)
        let shortSide = min(abs(oriented.width), abs(oriented.height))

        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
          throw MediaToolsException("Couldn't prepare the video.")
        }

        if options.maxHeight > 0 && shortSide > CGFloat(options.maxHeight) {
          // Scale so the short side matches the chosen size (720 = 720p), keeping the orientation.
          let scale = CGFloat(options.maxHeight) / shortSide
          let renderWidth = (abs(oriented.width) * scale / 2).rounded() * 2
          let renderHeight = (abs(oriented.height) * scale / 2).rounded() * 2
          let fps = try await videoTrack.load(.nominalFrameRate)

          let videoComposition = AVMutableVideoComposition()
          videoComposition.renderSize = CGSize(width: renderWidth, height: renderHeight)
          videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, min(60, Int(fps.rounded())))))

          let instruction = AVMutableVideoCompositionInstruction()
          instruction.timeRange = CMTimeRange(start: .zero, duration: composition.duration)
          let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: compVideo)
          let placed = transform
            .concatenating(CGAffineTransform(translationX: -oriented.origin.x, y: -oriented.origin.y))
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
          layer.setTransform(placed, at: .zero)
          instruction.layerInstructions = [layer]
          videoComposition.instructions = [instruction]
          session.videoComposition = videoComposition
        } else {
          compVideo.preferredTransform = transform
        }

        session.outputURL = outputUri
        session.outputFileType = options.output == "mov" ? .mov : .mp4
        session.shouldOptimizeForNetworkUse = true
        try await self.run(session, to: outputUri, jobId: options.jobId)
        return outputUri.absoluteString
      }
    }

    AsyncFunction("thumbnail") { (uri: URL, outputUri: URL, maxSize: Double) async throws -> String in
      let generator = AVAssetImageGenerator(asset: AVURLAsset(url: uri))
      generator.appliesPreferredTrackTransform = true
      generator.maximumSize = CGSize(width: maxSize, height: maxSize)
      let tolerance = CMTime(seconds: 1, preferredTimescale: 600)
      generator.requestedTimeToleranceBefore = tolerance
      generator.requestedTimeToleranceAfter = tolerance
      let frame = try await generator.image(at: CMTime(seconds: 0.5, preferredTimescale: 600))
      guard let data = UIImage(cgImage: frame.image).jpegData(compressionQuality: 0.8) else {
        throw MediaToolsException("Couldn't make a thumbnail.")
      }
      try data.write(to: outputUri, options: .atomic)
      return outputUri.absoluteString
    }
  }

  // MARK: - Helpers

  private func run(_ session: AVAssetExportSession, to outputUri: URL, jobId: String) async throws {
    try? FileManager.default.removeItem(at: outputUri)
    let progressTask = Task { [weak self] in
      while !Task.isCancelled {
        self?.sendEvent("onProgress", ["jobId": jobId, "progress": Double(session.progress)])
        try? await Task.sleep(nanoseconds: 250_000_000)
      }
    }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously {
        continuation.resume()
      }
    }
    progressTask.cancel()
    guard session.status == .completed else {
      throw MediaToolsException(session.error?.localizedDescription ?? "The file couldn't be converted.")
    }
    sendEvent("onProgress", ["jobId": jobId, "progress": 1.0])
  }

  private func makeGif(asset: AVAsset, range: CMTimeRange, options: ConvertOptions, outputUri: URL) async throws -> String {
    let fps = max(1, min(30, options.gifFps))
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: options.gifSize, height: options.gifSize)
    let tolerance = CMTime(seconds: 0.5 / fps, preferredTimescale: 600)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance

    // GIFs get very large very fast, so cap them at 20 seconds.
    let length = min(range.duration.seconds, 20)
    let count = max(1, Int(length * fps))
    try? FileManager.default.removeItem(at: outputUri)
    guard let destination = CGImageDestinationCreateWithURL(outputUri as CFURL, UTType.gif.identifier as CFString, count, nil) else {
      throw MediaToolsException("Couldn't create the GIF.")
    }
    let fileProperties = [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFLoopCount as String: 0]]
    CGImageDestinationSetProperties(destination, fileProperties as CFDictionary)
    let frameProperties = [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFDelayTime as String: 1.0 / fps]]

    for index in 0..<count {
      let time = CMTime(seconds: range.start.seconds + Double(index) / fps, preferredTimescale: 600)
      let frame = try await generator.image(at: time)
      CGImageDestinationAddImage(destination, frame.image, frameProperties as CFDictionary)
      if index % 3 == 0 {
        sendEvent("onProgress", ["jobId": options.jobId, "progress": Double(index) / Double(count)])
      }
    }
    guard CGImageDestinationFinalize(destination) else {
      throw MediaToolsException("Couldn't save the GIF.")
    }
    sendEvent("onProgress", ["jobId": options.jobId, "progress": 1.0])
    return outputUri.absoluteString
  }

  private static func orientedSize(of track: AVAssetTrack) async throws -> CGSize {
    let size = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let rect = CGRect(origin: .zero, size: size).applying(transform)
    return CGSize(width: abs(rect.width), height: abs(rect.height))
  }

  private static func trimRange(start: Double, end: Double, duration: CMTime) -> CMTimeRange {
    let total = duration.seconds.isFinite ? duration.seconds : 0
    let from = max(0, min(start, total))
    var to = end > 0 ? min(end, total) : total
    if to <= from {
      to = total
    }
    return CMTimeRange(
      start: CMTime(seconds: from, preferredTimescale: 600),
      end: CMTime(seconds: to, preferredTimescale: 600)
    )
  }
}
