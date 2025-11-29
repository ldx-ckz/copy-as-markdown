// content.js 
console.log('Content script loaded');

// 监听 ping 消息以确认 content script 已加载
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  if (request.action === 'ping') {
    sendResponse({ status: 'ready' });
    return true;
  }
  
  if (request.action === 'copyAsMarkdown') {
    handleCopyAsMarkdown(request.options, sendResponse);
    return true; // 保持消息通道开放
  }
});

async function handleCopyAsMarkdown(options, sendResponse) {
  try {
    const selection = window.getSelection();
    
    if (!selection || selection.toString().trim() === '') {
      sendResponse({ success: false, error: '没有选中任何文本' });
      return;
    }
    
    // 获取选中内容的 HTML
    let htmlContent = '';
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = document.createElement('div');
      container.appendChild(range.cloneContents());
      htmlContent = container.innerHTML;
    }
    
    console.log('Original HTML:', htmlContent);
    
    // 转换为 Markdown
    let markdown = htmlToMarkdown(htmlContent, options);
    
    // 清理多余的换行
    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    
    // 添加来源信息
    if (options.includeSource) {
      markdown += `\n\n> 来源: [${document.title}](${window.location.href})`;
    }
    
    console.log('Converted Markdown:', markdown);
    
    // 复制到剪贴板
    await copyToClipboard(markdown);
    
    // 发送成功通知
    chrome.runtime.sendMessage({
      action: 'copySuccess',
      markdown: markdown
    });
    
    sendResponse({ success: true, markdown: markdown });
    
  } catch (error) {
    console.error('Copy error:', error);
    
    // 发送错误通知
    chrome.runtime.sendMessage({
      action: 'copyError',
      error: error.message
    });
    
    sendResponse({ success: false, error: error.message });
  }
}

// 改进的 HTML 到 Markdown 转换函数，专门处理 Wikipedia 的数学公式
function htmlToMarkdown(html, options = {}) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // 预处理：移除不需要的标签
  preprocessHTML(tempDiv);
  
  return convertNodeToMarkdown(tempDiv, options).trim();
}

// 预处理 HTML，移除不需要的标签和属性
function preprocessHTML(element) {
  // 移除 script、style 等标签
  const tagsToRemove = ['script', 'style', 'noscript', 'svg', 'iframe'];
  tagsToRemove.forEach(tag => {
    const elements = element.getElementsByTagName(tag);
    while (elements.length > 0) {
      elements[0].parentNode.removeChild(elements[0]);
    }
  });
  
  // 处理数学公式 - 针对 Wikipedia 的特殊处理
  processMathElements(element);
  
  // 处理 Wikipedia 的特殊结构
  const editLinks = element.querySelectorAll('[accesskey], .mw-editsection, .reference, .references');
  editLinks.forEach(link => link.remove());
  
  // 处理上标和下标
  processSupSubElements(element);
}

// 处理数学公式
function processMathElements(element) {
  // 处理 Wikipedia 的数学公式
  const mathElements = element.querySelectorAll('.mwe-math-element, .mwe-math-fallback-image-inline, .mwe-math-fallback-image-display, .tex, .mwe-math-mathml-a11y');
  
  mathElements.forEach(mathEl => {
    // 尝试提取 LaTeX 源码
    let latex = extractLatexFromElement(mathEl);
    
    if (latex) {
      const span = document.createElement('span');
      span.className = 'math-formula';
      
      // 判断是行内公式还是块级公式
      const isDisplay = mathEl.classList.contains('mwe-math-fallback-image-display') || 
                       mathEl.classList.contains('mwe-math-element') && 
                       mathEl.querySelector('.mwe-math-mathml-display');
      
      if (isDisplay) {
        span.textContent = `$$\n${latex}\n$$`;
      } else {
        span.textContent = `$${latex}$`;
      }
      
      mathEl.parentNode.replaceChild(span, mathEl);
    } else {
      // 如果无法提取 LaTeX，至少保留 alt 文本
      const img = mathEl.querySelector('img');
      if (img && img.alt) {
        const span = document.createElement('span');
        span.className = 'math-formula';
        span.textContent = `$${img.alt}$`;
        mathEl.parentNode.replaceChild(span, mathEl);
      }
    }
  });
  
  // 处理简单的数学表达式
  const simpleMathSpans = element.querySelectorAll('span[style*="math"], span.math');
  simpleMathSpans.forEach(span => {
    const mathText = span.textContent || span.innerText;
    if (mathText.trim()) {
      const newSpan = document.createElement('span');
      newSpan.className = 'math-formula';
      newSpan.textContent = `$${mathText.trim()}$`;
      span.parentNode.replaceChild(newSpan, span);
    }
  });
}

// 从数学元素中提取 LaTeX 源码
function extractLatexFromElement(mathEl) {
  // 方法1: 从 alt 属性提取
  const img = mathEl.querySelector('img');
  if (img && img.alt) {
    return img.alt.trim();
  }
  
  // 方法2: 从注释中提取 (Wikipedia 有时会将 LaTeX 放在注释中)
  const comments = getComments(mathEl);
  for (const comment of comments) {
    if (comment.textContent.includes('TeX') || comment.textContent.includes('LaTeX')) {
      const match = comment.textContent.match(/\\begin\{equation\}(.*?)\\end\{equation\}/s) ||
                   comment.textContent.match(/\$\$(.*?)\$\$/s) ||
                   comment.textContent.match(/\$(.*?)\$/);
      if (match) {
        return match[1].trim();
      }
    }
  }
  
  // 方法3: 从 data 属性中提取
  if (mathEl.dataset.latex) {
    return mathEl.dataset.latex;
  }
  
  // 方法4: 从文本内容中提取
  const text = mathEl.textContent || mathEl.innerText;
  if (text && text.trim() && !text.includes('<!--')) {
    return text.trim();
  }
  
  return null;
}

// 获取元素内的所有注释
function getComments(element) {
  const comments = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_COMMENT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    comments.push(node);
  }
  
  return comments;
}

// 处理上标和下标
function processSupSubElements(element) {
  // 处理上标
  const supElements = element.querySelectorAll('sup');
  supElements.forEach(sup => {
    const content = sup.textContent || sup.innerText;
    if (content.trim()) {
      const span = document.createElement('span');
      span.textContent = `^${content.trim()}`;
      sup.parentNode.replaceChild(span, sup);
    }
  });
  
  // 处理下标
  const subElements = element.querySelectorAll('sub');
  subElements.forEach(sub => {
    const content = sub.textContent || sub.innerText;
    if (content.trim()) {
      const span = document.createElement('span');
      span.textContent = `_${content.trim()}`;
      sub.parentNode.replaceChild(span, sub);
    }
  });
}

function convertNodeToMarkdown(node, options, depth = 0) {
  let markdown = '';
  
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      markdown += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      markdown += convertElementToMarkdown(child, options, depth);
    }
  }
  
  return markdown;
}

function convertElementToMarkdown(element, options, depth) {
  const tagName = element.tagName.toLowerCase();
  const content = convertNodeToMarkdown(element, options, depth + 1);
  
  // 特殊处理数学公式
  if (element.classList.contains('math-formula')) {
    return content; // 已经处理过，直接返回
  }
  
  switch (tagName) {
    case 'h1': return `# ${content}\n\n`;
    case 'h2': return `## ${content}\n\n`;
    case 'h3': return `### ${content}\n\n`;
    case 'h4': return `#### ${content}\n\n`;
    case 'h5': return `##### ${content}\n\n`;
    case 'h6': return `###### ${content}\n\n`;
    case 'p': return `${content}\n\n`;
    case 'br': return '\n';
    case 'strong':
    case 'b': return `**${content}**`;
    case 'em':
    case 'i': return `*${content}*`;
    case 'code':
      if (element.parentElement?.tagName.toLowerCase() === 'pre') {
        return content;
      }
      return `\`${content}\``;
    case 'pre': 
      // 检测是否是代码块
      const codeElement = element.querySelector('code');
      const language = codeElement ? codeElement.className.replace('language-', '') : '';
      return `\`\`\`${language}\n${content}\n\`\`\`\n\n`;
    case 'blockquote': return `> ${content.split('\n').join('\n> ')}\n\n`;
    case 'a':
      if (options.preserveLinks && element.href) {
        const title = element.title ? ` "${element.title}"` : '';
        // 处理内部链接和外部链接
        const linkText = content || element.textContent || '';
        // 如果是内部锚点链接，只保留文本
        if (element.href.startsWith('#') || element.getAttribute('href')?.startsWith('#')) {
          return linkText;
        }
        return `[${linkText}](${element.href}${title})`;
      }
      return content;
    case 'img':
      if (options.preserveImages && element.src) {
        const alt = element.alt || '';
        return `![${alt}](${element.src})`;
      }
      return element.alt || '';
    case 'ul':
    case 'ol':
      return convertListToMarkdown(element, options, depth);
    case 'li':
      const prefix = element.parentElement?.tagName.toLowerCase() === 'ol' 
        ? `${depth}. ` 
        : '- ';
      return `${prefix}${content}\n`;
    case 'hr': return '---\n\n';
    case 'table':
      return convertTableToMarkdown(element, options);
    case 'div':
    case 'span':
      // 对于 div 和 span，只返回内容，不添加额外格式
      return content;
    default:
      return content;
  }
}

function convertListToMarkdown(list, options, depth) {
  let markdown = '';
  const isOrdered = list.tagName.toLowerCase() === 'ol';
  let itemNumber = 1;
  
  for (const item of list.children) {
    if (item.tagName.toLowerCase() === 'li') {
      const prefix = isOrdered ? `${itemNumber}. ` : '- ';
      const itemContent = convertNodeToMarkdown(item, options, depth + 1).trim();
      markdown += `${prefix}${itemContent}\n`;
      itemNumber++;
    }
  }
  
  return markdown + '\n';
}

function convertTableToMarkdown(table, options) {
  let markdown = '';
  const rows = table.querySelectorAll('tr');
  
  if (rows.length === 0) return '';
  
  // 表头
  const headerCells = rows[0].querySelectorAll('th, td');
  if (headerCells.length > 0) {
    markdown += '| ' + Array.from(headerCells).map(cell => {
      return convertNodeToMarkdown(cell, options).trim();
    }).join(' | ') + ' |\n';
    
    // 分隔线
    markdown += '| ' + Array.from(headerCells).map(() => '---').join(' | ') + ' |\n';
  }
  
  // 数据行
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td');
    if (cells.length > 0) {
      markdown += '| ' + Array.from(cells).map(cell => {
        return convertNodeToMarkdown(cell, options).trim();
      }).join(' | ') + ' |\n';
    }
  }
  
  return markdown + '\n';
}

// 复制到剪贴板的函数
function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    if (navigator.clipboard && window.isSecureContext) {
      if (!document.hasFocus()) {
        window.focus();
      }
      
      navigator.clipboard.writeText(text).then(resolve).catch(err => {
        console.warn('Clipboard API failed, trying fallback:', err);
        fallbackCopyToClipboard(text, resolve, reject);
      });
    } else {
      fallbackCopyToClipboard(text, resolve, reject);
    }
  });
}

function fallbackCopyToClipboard(text, resolve, reject) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    let successful = false;
    try {
      successful = document.execCommand('copy');
    } catch (err) {
      console.warn('execCommand failed:', err);
    }
    
    document.body.removeChild(textArea);
    
    if (successful) {
      resolve();
    } else {
      reject(new Error('复制失败：无法访问剪贴板'));
    }
  } catch (err) {
    reject(new Error('复制失败：' + err.message));
  }
}