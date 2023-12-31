function removeCodeAndComment (body) {
  return body
    .replace(/<!--[\w\W\s]*?-->/gmi, '')
    .replace(/`{3}(.|\n)*`{3}/gmi, '')
    .replace(/#.*\s?/g, '')
    .replace(/-{3}\s?/g, '')
}

function removeHTMLComment (body) {
  return body.replace(/<!--[\w\W\s]*?-->/gmi, '')
}

function replaceAll (str, search, replacement) {
  return str.replace(new RegExp(search, 'g'), replacement)
}

function utf8ToBase64(data) {
  return Buffer.from(data, 'utf-8').toString('base64')
}

function base64ToUtf8(data) {
  return Buffer.from(data, 'base64').toString('utf-8')
}

module.exports = {
  removeCodeAndComment,
  removeHTMLComment,
  replaceAll,
  utf8ToBase64,
  base64ToUtf8
}
