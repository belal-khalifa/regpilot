const statusEl = document.getElementById('status')
const clearBtn = document.getElementById('clear-btn')

function render(pendingFill) {
  if (pendingFill) {
    statusEl.textContent = `"${pendingFill.productName || 'A product'}" is ready — open Montaji, go to the step you are on and click "Fill this step" on the RegPilot panel.`
    clearBtn.disabled = false
  } else {
    statusEl.textContent = 'Nothing queued. Review a product in RegPilot and click "Fill on Montaji" there first.'
    clearBtn.disabled = true
  }
}

chrome.runtime.sendMessage({ type: 'GET_FILL_DATA' }, (response) => {
  render(response && response.pendingFill)
})

clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_FILL_DATA' }, () => {
    render(null)
  })
})
