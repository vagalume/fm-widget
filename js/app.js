/**
* ID3 parser
*/
var ID3 = {
	isHeader: function(data, offset) {
		/*
		* http://id3.org/id3v2.3.0
		* [0]     = 'I'
		* [1]     = 'D'
		* [2]     = '3'
		* [3,4]   = {Version}
		* [5]     = {Flags}
		* [6-9]   = {ID3 Size}
		*
		* An ID3v2 tag can be detected with the following pattern:
		*  $49 44 33 yy yy xx zz zz zz zz
		* Where yy is less than $FF, xx is the 'flags' byte and zz is less than $80
		*/
		if (offset + 10 <= data.length) {
			//look for 'ID3' identifier
			if (data[offset] === 0x49 && data[offset+1] === 0x44 && data[offset+2] === 0x33) {
				//check version is within range
				if (data[offset+3] < 0xFF && data[offset+4] < 0xFF) {
					//check size is within range
					if (data[offset+6] < 0x80 && data[offset+7] < 0x80 && data[offset+8] < 0x80 && data[offset+9] < 0x80) {
						return true;
					}
				}
			}
		}

		return false;
	},

	isFooter: function(data, offset) {
		/*
		* The footer is a copy of the header, but with a different identifier
		*/
		if (offset + 10 <= data.length) {
			//look for '3DI' identifier
			if (data[offset] === 0x33 && data[offset+1] === 0x44 && data[offset+2] === 0x49) {
				//check version is within range
				if (data[offset+3] < 0xFF && data[offset+4] < 0xFF) {
					//check size is within range
					if (data[offset+6] < 0x80 && data[offset+7] < 0x80 && data[offset+8] < 0x80 && data[offset+9] < 0x80) {
						return true;
					}
				}
			}
		}

		return false;
	},

	getID3Data: function(data, offset) {
		var front = offset;
		var length = 0;

		while (ID3.isHeader(data, offset)) {
			//ID3 header is 10 bytes
			length += 10;

			var size = ID3._readSize(data, offset + 6);
			length += size;

			if (ID3.isFooter(data, offset + 10)) {
				//ID3 footer is 10 bytes
				length += 10;
			}

			offset += length;
		}

		if (length > 0) {
			return data.subarray(front, front + length);
		}

		return undefined;
	},

	_readSize: function(data, offset) {
		var size = 0;
		size  = ((data[offset]   & 0x7f) << 21);
		size |= ((data[offset+1] & 0x7f) << 14);
		size |= ((data[offset+2] & 0x7f) << 7);
		size |=  (data[offset+3] & 0x7f);
		return size;
	},

	getTimeStamp: function(data) {
		var frames = ID3.getID3Frames(data);
		for(var i = 0; i < frames.length; i++) {
			var frame = frames[i];
			if (ID3.isTimeStampFrame(frame)) {
				return ID3._readTimeStamp(frame);
			}
		}

		return undefined;
	},

	isTimeStampFrame: function(frame) {
		return (frame && frame.key === 'PRIV' && frame.info === 'com.apple.streaming.transportStreamTimestamp');
	},

	_getFrameData: function(data) {
		/*
		Frame ID       $xx xx xx xx (four characters)
		Size           $xx xx xx xx
		Flags          $xx xx
		*/
		var type = String.fromCharCode(data[0], data[1], data[2], data[3]);
		var size = ID3._readSize(data, 4);

		//skip frame id, size, and flags
		var offset = 10;

		return { type: type, size: size, data: data.subarray(offset, offset + size) };
	},

	getID3Frames: function(id3Data) {
		var offset = 0;
		var frames = [];

		while (ID3.isHeader(id3Data, offset)) {
			var size = ID3._readSize(id3Data, offset + 6);
			//skip past ID3 header
			offset += 10;
			var end = offset + size;
			//loop through frames in the ID3 tag
			while (offset + 8 < end) {
				var frameData = ID3._getFrameData(id3Data.subarray(offset));
				var frame = ID3._decodeFrame(frameData);
				if (frame) {
					frames.push(frame);
				}
				//skip frame header and frame data
				offset += frameData.size + 10;
			}

			if (ID3.isFooter(id3Data, offset)) {
				offset += 10;
			}
		}

		return frames;
	},

	_decodeFrame: function(frame) {
		if (frame.type === 'PRIV') {
			return ID3._decodePrivFrame(frame);
		} else if (frame.type[0] === 'T') {
			return ID3._decodeTextFrame(frame);
		} else if (frame.type[0] === 'W') {
			return ID3._decodeURLFrame(frame);
		}

		return undefined;
	},

	_readTimeStamp: function(timeStampFrame) {
		if (timeStampFrame.data.byteLength === 8) {
			var data = new Uint8Array(timeStampFrame.data);
			// timestamp is 33 bit expressed as a big-endian eight-octet number,
			// with the upper 31 bits set to zero.
			var pts33Bit = data[3] & 0x1;
			var timestamp = (data[4] << 23) +
			(data[5] << 15) +
			(data[6] <<  7) +
			data[7];
			timestamp /= 45;

			if (pts33Bit) {
				timestamp += 47721858.84; // 2^32 / 90
			}

			return Math.round(timestamp);
		}

		return undefined;
	},

	_decodePrivFrame: function(frame) {
		/*
		Format: <text string>\0<binary data>
		*/
		if (frame.size < 2) {
			return undefined;
		}

		var owner = ID3._utf8ArrayToStr(frame.data);
		var privateData = new Uint8Array(frame.data.subarray(owner.length + 1));

		return { key: frame.type, info: owner, data: privateData.buffer };
	},

	_decodeTextFrame: function(frame) {
		if (frame.size < 2) {
			return undefined;
		}

		if (frame.type === 'TXXX') {
			/*
			Format:
			[0]   = {Text Encoding}
			[1-?] = {Description}\0{Value}
			*/
			var index = 1;
			var description = ID3._utf8ArrayToStr(frame.data.subarray(index));

			index += description.length + 1;
			var value = ID3._utf8ArrayToStr(frame.data.subarray(index));

			return { key: frame.type, info: description, data: value };
		} else {
			/*
			Format:
			[0]   = {Text Encoding}
			[1-?] = {Value}
			*/
			var text = ID3._utf8ArrayToStr(frame.data.subarray(1));
			return { key: frame.type, data: text };
		}
	},

	_decodeURLFrame: function(frame) {
		if (frame.type === 'WXXX') {
			/*
			Format:
			[0]   = {Text Encoding}
			[1-?] = {Description}\0{URL}
			*/
			if (frame.size < 2) {
				return undefined;
			}

			var index = 1;
			var description = ID3._utf8ArrayToStr(frame.data.subarray(index));

			index += description.length + 1;
			var value = ID3._utf8ArrayToStr(frame.data.subarray(index));

			return { key: frame.type, info: description, data: value };
		} else {
			/*
			Format:
			[0-?] = {URL}
			*/
			var url = ID3._utf8ArrayToStr(frame.data);
			return { key: frame.type, data: url };
		}
	},

	_utf8ArrayToStr: function(array) {

		var char2;
		var char3;
		var out = '';
		var i = 0;
		var length = array.length;

		while (i < length) {
			var c = array[i++];
			switch (c >> 4) {
				case 0:
				return out;
				case 1: case 2: case 3: case 4: case 5: case 6: case 7:
				// 0xxxxxxx
				out += String.fromCharCode(c);
				break;
				case 12: case 13:
				// 110x xxxx   10xx xxxx
				char2 = array[i++];
				out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
				break;
				case 14:
				// 1110 xxxx  10xx xxxx  10xx xxxx
				char2 = array[i++];
				char3 = array[i++];
				out += String.fromCharCode(((c & 0x0F) << 12) |
				((char2 & 0x3F) << 6) |
				((char3 & 0x3F) << 0));
				break;
			}
		}

		return out;
	}
}

var fmWidget = {};

(function() {
	var station = null;

	var audio;
	var hls;
	var state = 0;

	var target = 'https://vagalume.fm/';

	var currentSong;
	var nextSongList;

	var metadataList = [];
	var metadataTimeout = [];

	var progressTimeout;

	// Constantes
	var HLS_TOTAL_TARGET_DURATION = 3;
	var STATE_BUFFERING = 1;
	var STATE_RUNNING = 2;
	var STATE_STOPPED = 3;
	var START_ERROR = 1;
	var REQUEST_ERROR = 10;
	var RESPONSE_ERROR = 20;
	var NOT_SUPPORTED_ERROR = 30;
	var MEDIA_ERROR = 40;

	var $widget = document.querySelector('#vglFM');
	var $widgetBG = $widget.querySelector('.background');
	var $stationImage = $widget.querySelector('.station-img > img');
	var $stationName = $widget.querySelector('#stationName');
	var $artistName = $widget.querySelector('#artistName');
	var $songName = $widget.querySelector('#songName');
	var $nextSongList = $widget.querySelector('#nextSongList');
	var $togglePlay = $widget.querySelector('#togglePlay');
	var $playIcon = $togglePlay.querySelector('img');
	var $loader = $widget.querySelector('.loader');
	var $progress = $widget.querySelector('#progress');
	var $startTime = $widget.querySelector('#startTime');
	var $endTime = $widget.querySelector('#endTime');
	var $errorPopup = $widget.querySelector('#errorPopup');
	var $closeError = $widget.querySelector('#closeError');
	var $closeShare = $widget.querySelector('#closeShare');
	var $shareBox = $widget.querySelector('#shareBox');
	var $shareButton = $widget.querySelector('.options button.share');
	var $openPopup = $widget.querySelector('.options button.pop-up');
	var $shareLinks = $widget.querySelectorAll('.share-links');

	function getStation(stationID) {
		var xhr = new XMLHttpRequest();

		return new Promise(function(resolve, reject) {
			xhr.open('GET', "https://api.vagalume.fm/v2/" + stationID, true);
			xhr.send();

			xhr.addEventListener("readystatechange", function(e) {
				if (xhr.readyState == 4 && xhr.status == 200) {
					var response = JSON.parse(xhr.responseText);
					if (response instanceof Object && response.id) {
						resolve(response);
					} else {
						reject(RESPONSE_ERROR);
					}
				}
			}, false);
		});
	};

	function getNextSongs(stationID) {
		var xhr = new XMLHttpRequest();

		return new Promise(function(resolve, reject) {
			xhr.open('GET', "https://api.vagalume.fm/v2/" + stationID + "/next?count=20", true);
			xhr.send();

			xhr.addEventListener("readystatechange", function(e) {
				if (xhr.readyState == 4 && xhr.status == 200) {
					var response = JSON.parse(xhr.responseText);
					if (response instanceof Object && response.content) {
						resolve(response.content);
					} else {
						reject(RESPONSE_ERROR);
					}
				}
			}, false);
		});
	}

	function buildNextList(songs) {
		var $nextList = '';
		for (var i = 0; i < songs.length; i++) {
			var song = songs[i];
			var startTime = new Date(song.tsStart * 1000);
			var hours = startTime.getHours() > 9 ? startTime.getHours() : '0' + startTime.getHours();
			var minutes = startTime.getMinutes() > 9 ? startTime.getMinutes() : '0' + startTime.getMinutes();
			$nextList += '<li>'
				+ '<div class="content">'
					+ '<a href="' + song.title.url + '" target=_blank>'
					+ '<img src="https://s2.vagalume.com/' + song.artist.slug + '/images/profile.jpg" />'
					+ '<div class="song-info">'
						+ '<p>' + song.artist.name + '</p>'
						+ '<p>' + song.title.name + '</p>'
					+ '</div>'
					+ '</a>'
				+ '</div>'
				+ '<span class="next-time">TOCARÁ ÀS ' + (hours + ':' + minutes) + '</span>'
			+ '</li>';
		}

		$nextSongList.innerHTML = $nextList;
	}

	function setStationSongs() {
		getNextSongs(station.id)
		.then(function(songs) {
			var song = songs.splice(0, 1)[0];
			nextSongList = songs;

			$artistName.innerHTML = song.artist.name;
			$songName.innerHTML = song.title.name;

			buildNextList(songs);
		})
		.catch(function(error) {
			setError(error);
		});
	}

	function showErrorMessage(message) {
		$errorPopup.querySelector('span').innerHTML = message;
		$errorPopup.setAttribute('class', '');
	}

	function setError(error) {
		stop();
		switch (error) {
			case START_ERROR:
				showErrorMessage('Ocorreu um problema ao iniciar a estação');
				break;
			case REQUEST_ERROR:
			case RESPONSE_ERROR:
				showErrorMessage('Não foi possível conectar ao servidor');
				break;
			case NOT_SUPPORTED_ERROR:
				showErrorMessage('Não foi possível iniciar, navegador não suportado');
				break;
			case MEDIA_ERROR:
				play();
				break;
			default:
		}
	}

	function buildWidget(info) {
		station = info;

		$widgetBG.style.backgroundImage = "url('" + station.img['bg-low'] + "')";
		$stationImage.setAttribute('src', station.img.default);
		$stationName.innerHTML = station.name;
	}

	function onTogglePlay() {
		if (audio && hls) {
			if (state !== STATE_RUNNING) {
				play();
			} else {
				stop();
			}
		} else {
			play();
		}
	}

	function onOpenPopup() {
		window.open(target, "MsgWindow", "width=600,height=600");
	}

	function onToggleShareBox() {
		if ($shareBox.getAttribute('class') == 'hide') {
			$shareBox.setAttribute('class', '');
		} else {
			$shareBox.setAttribute('class', 'hide');
		}
	}

	function onCloseError() {
		$errorPopup.setAttribute('class', 'hide');
	}

	function play() {
		if (state !== 0) setState(STATE_BUFFERING);
		if (!audio || !hls) createPlayer();

		audio.play();
	}

	function stop() {
		hls && hls.destroy();
		hls = null;
		audio = null;

		stopProgress();
		metadataList = [];
		clearTimeout(metadataTimeout);

		setState(STATE_STOPPED);
		currentSong = null;
	}

	function createPlayer() {
		if (Hls.isSupported()) {
			audio = new Audio;
			hls = new Hls({ liveSyncDurationCount: HLS_TOTAL_TARGET_DURATION, fragLoadingMaxRetry: 15, manifestLoadingMaxRetry: 15, levelLoadingMaxRetry: 15, defaultAudioCodec: 'mp4a.40.5', fragLoadingMaxRetryTimeout: 2500, manifestLoadingMaxRetryTimeout: 2500, levelLoadingMaxRetryTimeout: 2500, manifestLoadingTimeOut: 30000, levelLoadingTimeOut: 30000, fragLoadingTimeOut: 80000 });

			hls.loadSource("http://stream.vagalume.fm/hls/" + station.id + "/aac.m3u8");
			hls.attachMedia(audio);
			hls.startLoad(0);

			setPlayerEvents();
		} else {
			setError(NOT_SUPPORTED_ERROR);
		}
	}

	function setCurrentSong(metadata) {
		if (!currentSong || metadata.extra.pointerID !== currentSong.id) {
			currentSong = {
				id: metadata.extra.pointerID,
				artist: metadata.band,
				song: metadata.song,
				position: metadata.time.tsStart,
				duration: metadata.duration
			};

			$artistName.innerHTML = currentSong.artist;
			$songName.innerHTML = currentSong.song;

			setProgress(currentSong.position, currentSong.duration);
			startProgress();

			if (nextSongList && nextSongList.length) {
				var isInside = -1;
				for (var i = 0; i < nextSongList.length; i++) {
					var song = nextSongList[i];

					if (song.title.id == currentSong.id) {
						isInside = i;
					}
				}

				if (isInside != -1) {
					nextSongList =  nextSongList.slice(isInside + 1);
				}

				if (nextSongList.length < 5) {
					getNextSongs(station.id)
					.then(function(songs) {
						songs.splice(0, 1)[0];
						nextSongList = songs;

						buildNextList(songs);
					})
					.catch(function(error) {
						setError(error);
					});
				} else {
					buildNextList(nextSongList);
				}
			}
		}
	}

	function sendMetadata() {
		if (metadataList.length) {
			var metadata = metadataList[0];

			var nextCall = (metadata.time.tsEnd - metadata.time.tsStart) * 1000;
			clearTimeout(metadataTimeout);

			setCurrentSong(metadata);

			metadataTimeout = setTimeout(function() {
				metadataList.splice(0, 1);
				sendMetadata();
			}, nextCall);
		}
	}

	function setPlayerEvents() {
		hls.on(Hls.Events.ERROR, function (event, data) {
			if (data.type === 'mediaError' || (data.type === 'networkError' && state !== STATE_RUNNING)) {
				setError(MEDIA_ERROR);
			}
		});

		hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
			if (data.frag && (data.frag.sn === 0 && data.frag.start === 0)) {
				setError(MEDIA_ERROR);
			}
		});

		hls.on(Hls.Events.FRAG_PARSING_METADATA, function (event, data) {
				if (data && data.samples && data.samples.length && data.samples[0].data) {
					var frames = ID3.getID3Frames(data.samples[0]['data']);
					var metadata = {};

					for (key in frames) {
						var metaValue = frames[key].data;
						if (frames[key].key === "TPE1") {
							metadata.band = metaValue;
						} else if (frames[key].key === "TPE2") {
							metadata.band_url = metaValue;
						} else if (frames[key].key === "TIT2") {
							metadata.song = metaValue;
						} else if (frames[key].key === "TIT3") {
							metadata.song_url = metaValue;
						} else if (frames[key].key === "TLEN") {
							metadata.duration = parseFloat(metaValue);
						} else if (frames[key].key === "TOFN") {
							metadata.segment = metaValue;
						} else if (frames[key].key === "TIME") {
							metadata.time = JSON.parse(metaValue);
						} else if (frames[key].key === "TXXX") {
							metadata.extra = JSON.parse(metaValue);
						}
					}

					if (metadataList.length) {
						if (metadataList[metadataList.length - 1].segment !== metadata.segment) {
							metadataList.push(metadata);
						}
					} else {
						metadataList.push(metadata);
					}
				}
			});

		audio.addEventListener('pause', function(e) {
			stop();
		});

		audio.addEventListener('playing', function(e) {
			setState(STATE_RUNNING);
		});
	}

	function setState(code) {
		state = code;
		switch (code) {
			case STATE_BUFFERING:
				showLoading();
				break;
			case STATE_RUNNING:
				showTogglePlay();
				$playIcon.setAttribute('src', '/img/ico-pause.svg');
				sendMetadata();
				break;
			case STATE_STOPPED:
				showTogglePlay();
				$playIcon.setAttribute('src', '/img/ico-play.svg');
				break;
			default:
		}
	}

	function showLoading() {
		if ($togglePlay.style.display !== 'none') {
			$togglePlay.style.display = 'none';
			$loader.style.display = 'flex';
		}
	}

	function showTogglePlay() {
		if ($loader.style.display !== 'none') {
			$loader.style.display = 'none';
			$togglePlay.style.display = 'flex';
		}
	}

	function setProgress(position, duration) {
		if (position && duration) {
			var percent = Math.floor((position / duration) * 100);

			var date = new Date(null);
			date.setSeconds(position);
			var start = date.toISOString().substr(11, 8).match(/\w+:([^\.\/]+)/)[1];

			date = new Date(null);
			date.setSeconds(duration);
			var end = date.toISOString().substr(11, 8).match(/\w+:([^\.\/]+)/)[1];

			$startTime.innerHTML = start;
			$endTime.innerHTML = end;
			$progress.style.width = percent + '%';
		}
	}

	function startProgress() {
		stopProgress();
		var last = Date.now();
		progressTimeout = setTimeout(function() {
			var now = Date.now();
			var diff = (now - last) / 1000;
			currentSong.position += diff;
			if (currentSong.position <= currentSong.duration) {
				setProgress(currentSong.position, currentSong.duration);
				startProgress();
			}
		}, 1000);
	}

	function stopProgress() {
		clearTimeout(progressTimeout);
		progressTimeout = null;
	}

	function buildShareLinks() {
		var socialLinks = ['Facebook', 'Twitter', 'Google+', 'WhatsApp', 'Messenger'];
		var $socialList = '';

		for (var i = 0; i < socialLinks.length; i++) {
			var social = socialLinks[i];
			var socialClass = social.match(/\w+/g)[0].toLowerCase();
			var shareLink = '';
			var shareMessage = 'Venha escutar comigo a estação ' + station.name + ' no Vagalume.FM!';
			var stationURL = 'https://vagalume.fm/' + station.slug + '/';

			switch (social) {
				case 'Facebook':
					link = 'https://www.facebook.com/sharer/sharer.php?u=' + stationURL;
				break;
				case 'Twitter':
					link = 'https://twitter.com/intent/tweet?url=' + stationURL + '&text=' + shareMessage;
				break;
				case 'Google+':
					link = 'https://plus.google.com/share?url=' + stationURL;
				break;
				case 'WhatsApp':
					link = 'whatsapp://send?text=' + shareMessage + ' ' + stationURL;
				break;
				case 'Messenger':
					link = 'fb-messenger://share/?link=' + stationURL + '&app_id=324474348807';
				break;
				default:
			}

			$socialList += '<li class="share-' + socialClass + '">'
				+'<a target="_blank" href="' + encodeURI(link) + '">'
					+'<img src="/img/ico-' + socialClass + '.svg" title="' + social + '" />'
					+'<span>' + social + '</span>'
				+'</a>'
			+'</li>';
		}

		$shareBox.querySelector('ul').innerHTML = $socialList;

		for (var i = 0; i < $shareLinks.length; i++) {
			$shareLinks[i].setAttribute('href', 'https://vagalume.fm/' + station.slug + '/share');
		}

		$closeShare.addEventListener('click', onToggleShareBox);
		$shareButton.addEventListener('click', onToggleShareBox);
	}

	fmWidget.init = function(params) {
		var stationID = params.stationID;
		target = params.target;

		$closeError.addEventListener('click', onCloseError)

		if (stationID && typeof stationID == "string") {
			getStation(stationID)
			.then(function(response) {
				buildWidget(response);

				buildShareLinks();
				setStationSongs();
				createPlayer();

				$openPopup.addEventListener('click', onOpenPopup);
				$togglePlay.addEventListener('click', onTogglePlay);
			})
			.catch(function(error) {
				setError(error);
			});
		} else {
			setError(START_ERROR);
		}
	};
})();
