Pod::Spec.new do |s|
  s.name           = 'MediaTools'
  s.version        = '1.0.0'
  s.summary        = 'Merges, converts and inspects media files with AVFoundation for GrabIt.'
  s.description    = 'Local Expo module used by the GrabIt app.'
  s.license        = 'MIT'
  s.author         = 'GrabIt'
  s.homepage       = 'https://github.com/eyadmaherrr/grabit'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/eyadmaherrr/grabit.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.frameworks = 'AVFoundation', 'ImageIO', 'UniformTypeIdentifiers'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
