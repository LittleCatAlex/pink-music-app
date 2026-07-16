// B 站音频流 ID 优先级排序（从低到高），配合 bandwidth 选择音质
export const audioQualitySort = [30257, 30216, 30259, 30260, 30232, 30280, 30250, 30251]

function sortAudio(audioList) {
  return [...audioList].sort((a, b) => {
    if (a.bandwidth !== b.bandwidth) {
      return b.bandwidth - a.bandwidth
    }
    const indexA = audioQualitySort.indexOf(a.id)
    const indexB = audioQualitySort.indexOf(b.id)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexB - indexA
  })
}

function selectAudioByQuality(audioList, quality) {
  if (!audioList || audioList.length === 0) return undefined

  const sortedList = sortAudio(audioList)

  switch (quality) {
    case 'high':
      return sortedList[0]
    case 'medium': {
      const midIndex = Math.floor((sortedList.length - 1) / 2)
      return sortedList[midIndex]
    }
    case 'low':
      return sortedList[sortedList.length - 1]
    case 'auto':
    case 'lossless':
    default:
      return sortedList[0]
  }
}

export function selectAudioInfo(playUrlData, audioQuality = 'auto') {
  if (!playUrlData) return null

  const dash = playUrlData.dash
  const durl = playUrlData.durl

  // auto / lossless 优先使用 FLAC / Dolby
  if (audioQuality === 'auto' || audioQuality === 'lossless') {
    const flacAudio = dash?.flac?.audio
    if (flacAudio) {
      return {
        url: flacAudio.baseUrl || flacAudio.base_url || flacAudio.backupUrl?.[0] || flacAudio.backup_url?.[0],
        codecs: flacAudio.codecs || 'flac'
      }
    }

    const dolbyAudio = dash?.dolby?.audio?.[0]
    if (dolbyAudio) {
      return {
        url: dolbyAudio.baseUrl || dolbyAudio.base_url || dolbyAudio.backupUrl?.[0] || dolbyAudio.backup_url?.[0],
        codecs: dolbyAudio.codecs || 'ec-3'
      }
    }
  }

  // 普通 DASH 音频流
  if (dash?.audio && dash.audio.length > 0) {
    const selected = selectAudioByQuality(dash.audio, audioQuality)
    if (selected) {
      return {
        url: selected.baseUrl || selected.base_url || selected.backupUrl?.[0] || selected.backup_url?.[0],
        codecs: selected.codecs || 'mp4a.40.2'
      }
    }
  }

  // 兜底：FLV/MP4 分段流
  if (durl && durl.length > 0) {
    return {
      url: durl[0].url,
      codecs: 'mp4a.40.2'
    }
  }

  return null
}

export function selectAudioUrl(playUrlData, audioQuality = 'auto') {
  const info = selectAudioInfo(playUrlData, audioQuality)
  return info?.url || null
}

export function getAudioExtByCodecs(codecs) {
  if (!codecs) return '.m4a'
  const c = String(codecs).toLowerCase()
  if (c.includes('flac')) return '.flac'
  if (c.includes('mp3')) return '.mp3'
  return '.m4a'
}

export function getAudioCodecLabel(codecs) {
  if (!codecs) return ''
  const c = String(codecs).toLowerCase()
  if (c.includes('flac')) return 'FLAC'
  if (c.includes('ec-3') || c.includes('eac3') || c.includes('e-ac-3')) return 'Dolby'
  if (c.includes('mp4a')) return 'AAC'
  if (c.includes('mp3')) return 'MP3'
  return codecs
}

export function formatAudioQualityLabel(quality) {
  const labels = {
    auto: '自动',
    lossless: '无损',
    high: '高音质',
    medium: '中音质',
    low: '低音质'
  }
  return labels[quality] || '自动'
}
