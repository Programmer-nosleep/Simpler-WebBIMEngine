
export type RightSidebarHandle = {
  toggle: (visible: boolean) => void;
};

// Helper to fetch icon content (assuming we might want to inline SVG for styling)
async function fetchIcon(name: string): Promise<string> {
  try {
    const response = await fetch(`/assets/icon/${name}.svg`);
    return await response.text();
  } catch (e) {
    console.error(`Failed to load icon: ${name}`, e);
    return "";
  }
}

export function setupRightSidebar(): RightSidebarHandle {
  let container = document.getElementById("rightSidebar");
  if (!container) {
    container = document.createElement("aside");
    container.id = "rightSidebar";
    document.body.appendChild(container);
  }

  container.innerHTML = "";
  container.classList.add("right-sidebar-message");
  container.classList.remove("visible");
  container.style.display = "none";

  // --- Header with Tab Switcher ---
  const header = document.createElement("div");
  header.className = "sidebar-message-header";

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "sidebar-tabs-container";

  // Tab State
  let activeTab: "messages" | "bimGPT" = "messages";


  // Tab Buttons
  const createTabBtn = async (id: "messages" | "bimGPT", iconName: string, label: string) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `sidebar-tab-btn ${activeTab === id ? "active" : ""}`;
    btn.dataset.tabId = id;

    // Fetch SVG content
    const svgContent = await fetchIcon(iconName);
    btn.innerHTML = `
      <span class="tab-icon">${svgContent}</span>
      <span class="tab-label">${label}</span>
    `;

    btn.addEventListener("click", () => {
      if (activeTab === id) return;

      // Update Tab UI
      header.querySelectorAll(".sidebar-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Switch Body
      switchTab(id);
    });

    return btn;
  };

  // Note: We use async but this setup is synchronous currently. 
  // We can append placeholders and fill them when promised.
  const messagesTabPromise = createTabBtn("messages", "ChatCircle", "Messages");
  const bimGptTabPromise = createTabBtn("bimGPT", "BrainCpu", "bimGPT");

  Promise.all([messagesTabPromise, bimGptTabPromise]).then(([msgBtn, gptBtn]) => {
    tabsContainer.appendChild(msgBtn);
    tabsContainer.appendChild(gptBtn);
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sidebar-message-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => handle.toggle(false));

  header.appendChild(tabsContainer);
  header.appendChild(closeBtn);
  container.appendChild(header);

  // --- Body Containers ---
  // 1. Standard Messages Body
  const bodyMessages = document.createElement("div");
  bodyMessages.className = "sidebar-message-body";

  const msgEmpty = document.createElement("div");
  msgEmpty.className = "sidebar-message-empty";
  msgEmpty.innerHTML = `
    <div class="empty-icon">💬</div>
    <div class="empty-text">No messages yet.</div>
    <div class="empty-subtext">Start a conversation from the list below.</div>
  `;
  bodyMessages.appendChild(msgEmpty);

  // 2. bimGPT Body (box style)
  const bodyGPT = document.createElement("div");
  bodyGPT.className = "sidebar-gpt-body";
  bodyGPT.style.display = "none";

  const gptEmpty = document.createElement("div");
  gptEmpty.className = "sidebar-gpt-empty";
  gptEmpty.innerHTML = `
    <div class="gpt-logo">
      <!-- Re-use icon or place standard brain icon -->
       <svg width="48" height="48" viewBox="0 0 24 24" fill="none" class="gpt-hero-icon">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="currentColor" opacity="0.2"/>
        <path d="M12 6C10.9 6 10 6.9 10 8C10 9.1 10.9 10 12 10C13.1 10 14 9.1 14 8C14 6.9 13.1 6 12 6ZM12 14C10.9 14 10 14.9 10 16C10 17.1 10.9 18 12 18C13.1 18 14 17.1 14 16C14 14.9 13.1 14 12 14ZM9 12C9 10.9 8.1 10 7 10C5.9 10 5 10.9 5 12C5 13.1 5.9 14 7 14C8.1 14 9 13.1 9 12ZM19 12C19 10.9 18.1 10 17 10C15.9 10 15 10.9 15 12C15 13.1 15.9 14 17 14C18.1 14 19 13.1 19 12Z" fill="currentColor"/>
       </svg>
    </div>
    <div class="gpt-welcome">How can I help you today?</div>
    <div class="gpt-suggestions">
      <button class="gpt-suggestion-box">Analyze this model struct...</button>
      <button class="gpt-suggestion-box">Generate a cost report...</button>
      <button class="gpt-suggestion-box">Check for clashes...</button>
      <button class="gpt-suggestion-box">Summarize properties...</button>
    </div>
  `;
  bodyGPT.appendChild(gptEmpty);

  container.appendChild(bodyMessages);
  container.appendChild(bodyGPT);

  // Tab Switching Logic
  const switchTab = (id: "messages" | "bimGPT") => {
    activeTab = id;
    if (activeTab === "messages") {
      bodyMessages.style.display = "flex";
      bodyGPT.style.display = "none";
    } else {
      bodyMessages.style.display = "none";
      bodyGPT.style.display = "flex";
    }
  };

  // --- Footer ---
  const footer = document.createElement("div");
  footer.className = "sidebar-message-footer";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a message...";
  input.className = "sidebar-message-input";

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "sidebar-message-send";
  sendBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 2L11 13M22 2L15 22L11 13M11 13L2 9L22 2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  footer.appendChild(input);
  footer.appendChild(sendBtn);
  container.appendChild(footer);

  // --- Message Handling ---
  const appendUserMessage = (text: string) => {
    const targetBody = activeTab === "messages" ? bodyMessages : bodyGPT;

    // Hide empty state if specific logic needed (mostly for Messages)
    if (activeTab === "messages") {
      const empty = targetBody.querySelector(".sidebar-message-empty") as HTMLElement;
      if (empty) empty.style.display = "none";

      const msgRow = document.createElement("div");
      msgRow.className = "sidebar-message-row user";
      const bubble = document.createElement("div");
      bubble.className = "sidebar-message-bubble";
      bubble.textContent = text;
      msgRow.appendChild(bubble);
      targetBody.appendChild(msgRow);
    } else {
      // bimGPT Logic: Hide welcome screen
      const gptEmpty = targetBody.querySelector(".sidebar-gpt-empty") as HTMLElement;
      if (gptEmpty) gptEmpty.style.display = "none";

      // Append User Message (GPT Style?)
      // For now, reuse row style but maybe wrapped differently
      const msgRow = document.createElement("div");
      msgRow.className = "sidebar-message-row user";
      const bubble = document.createElement("div");
      bubble.className = "sidebar-message-bubble";
      bubble.textContent = text;
      msgRow.appendChild(bubble);
      targetBody.appendChild(msgRow);

      // Simulate AI response placeholder if we were building real logic
      // For now just user message
    }

    targetBody.scrollTop = targetBody.scrollHeight;
  };

  const handleSend = () => {
    const text = input.value.trim();
    if (!text) return;

    appendUserMessage(text);
    input.value = "";
  };

  sendBtn.addEventListener("click", handleSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });

  const handle: RightSidebarHandle = {
    toggle: (visible: boolean) => {
      if (visible) {
        container!.style.display = "flex";
        requestAnimationFrame(() => container!.classList.add("visible"));
        // Focus input when opened
        setTimeout(() => input.focus(), 50);
      } else {
        container!.classList.remove("visible");
        setTimeout(() => {
          if (!container!.classList.contains("visible")) container!.style.display = "none";
        }, 300);
      }
    }
  };

  return handle;
}
