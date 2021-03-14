const { translate } = require('../src/translator')

const str = `
### What problem does this feature solve?
可视区域较小，但显示的类型较多，显示不全；
请问饼图有办法实现整体拖动，让未显示的区域可以显示出来吗？

拖动外层的div我试过了，只是拖动画布而已，并不能拖动里面饼图。

### What does the proposed API look like?
series.pie.dragging = true`

translate(str).then(res => console.log(res))

