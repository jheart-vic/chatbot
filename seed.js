switch (intent) {
  case 'create_order': {
    let parsed =
      user.conversationState?.tempOrder || (await parseOrderIntent(text))

    // 📝 Step 1 — Collect required details one by one
    if (!parsed.items || parsed.items.length === 0) {
      user.conversationState = { step: 'awaiting_items' }
      await user.save()
      botReply =
        "🧺 Please tell me what you'd like to wash (e.g. 3 shirts, 2 trousers)."
      break
    }

    if (!parsed.turnaround) {
      user.conversationState = {
        step: 'awaiting_turnaround',
        tempOrder: parsed
      }
      await user.save()
      botReply =
        '⏱ How fast do you need it?\n- Standard (48h)\n- Express (24h, +40%)\n- Same-day (6–8h, +80%, ≤15 items)'
      break
    }

    if (parsed.distanceKm == null) {
      user.conversationState = { step: 'awaiting_distance', tempOrder: parsed }
      await user.save()
      botReply = '🚚 How far are you from us (in km)? e.g. *3 km*'
      break
    }

    if (parsed.items.some(i => !i.service)) {
      user.conversationState = { step: 'awaiting_service', tempOrder: parsed }
      await user.save()
      botReply =
        '🧴 What service do you want for them?\n- Wash & Iron\n- Wash & Fold\n- Iron Only'
      break
    }

    // 💰 Step 2 — We have all details, now calculate price
    const {
      items: pricedItems,
      subtotal,
      deliveryFee,
      total: baseTotal,
      warnings
    } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

    // 🌟 Step 3 — Offer loyalty point usage if available
    if (
      user.loyaltyBalance > 0 &&
      user.conversationState?.step !== 'awaiting_points_confirm'
    ) {
      user.conversationState = {
        step: 'awaiting_points_confirm',
        tempOrder: { ...parsed, pricedItems },
        tempPrice: { subtotal, deliveryFee, baseTotal }
      }
      await user.save()

      botReply =
        `🧺 Order summary:\n${pricedItems
          .map(i => `• ${i.quantity} × ${i.name} (${i.service})`)
          .join('\n')}\n\n` +
        `💵 Subtotal: ₦${subtotal}\n🚚 Delivery: ₦${deliveryFee}\n💰 Total: ₦${baseTotal}\n\n` +
        `🌟 You have *${user.loyaltyBalance} points* (₦${user.loyaltyBalance}).\n` +
        `Would you like to use them? (yes/no)`
      break
    }

    // 💳 Step 4 — Process yes/no answer to using points
    if (user.conversationState?.step === 'awaiting_points_confirm') {
      const lower = text.toLowerCase()
      const { tempOrder, tempPrice } = user.conversationState
      let total = tempPrice.baseTotal
      let pointsUsed = 0

      if (/^(yes|y|sure|ok|yeah|use)$/i.test(lower)) {
        pointsUsed = Math.min(user.loyaltyBalance, total)
        total = total - pointsUsed
      }

      user.conversationState = {
        step: 'awaiting_order_confirm',
        tempOrder: {
          ...tempOrder,
          subtotal: tempPrice.subtotal,
          deliveryFee: tempPrice.deliveryFee,
          total,
          pointsUsed
        }
      }
      await user.save()

      botReply =
        pointsUsed > 0
          ? `✅ Using ₦${pointsUsed} points.\nNew total: ₦${total}\nConfirm order? (yes/no)`
          : `Total: ₦${total}\nConfirm order? (yes/no)`
      break
    }

    // ✅ Step 5 — Confirm and create the order
    if (user.conversationState?.step === 'awaiting_order_confirm') {
      if (/^(yes|y|ok|confirm|place|sure)$/i.test(text.toLowerCase())) {
        const {
          pricedItems,
          turnaround,
          distanceKm,
          delivery,
          payment,
          total,
          pointsUsed
        } = user.conversationState.tempOrder

        const now = DateTime.now().setZone('Africa/Lagos')
        const dueDate =
          turnaround === 'express'
            ? now.plus({ hours: 24 })
            : turnaround === 'same-day'
            ? now.plus({ hours: 8 })
            : now.plus({ days: 2 })

        const order = await Order.create({
          userId: user._id,
          items: pricedItems,
          turnaround,
          distanceKm,
          delivery,
          payment,
          status: 'Pending',
          price: total,
          assignedTo: await assignEmployee(),
          loyaltyEarned: Math.floor(total / 1000),
          loyaltyRedeemed: pointsUsed
        })

        user.totalOrders += 1
        user.loyaltyBalance =
          user.loyaltyBalance - pointsUsed + order.loyaltyEarned
        user.conversationState = {}
        await user.save()

        botReply = `🎉 Order placed!\n\n🧺 ${pricedItems
          .map(i => `${i.quantity} ${i.name}`)
          .join(', ')}\n💰 Total: ₦${total}\n⭐ Earned: ${
          order.loyaltyEarned
        } pts`
      } else {
        user.conversationState = {}
        await user.save()
        botReply = '❌ Order cancelled. You can start again anytime.'
      }
      break
    }

    break
  }

  case 'track_order': {
    const lastOrder = await Order.findOne({ userId: user._id }).sort({
      createdAt: -1
    })
    if (!lastOrder) {
      botReply = "📦 You don't have any orders yet."
    } else {
      botReply = `📦 Your last order is currently: ${
        STATUS_EMOJIS[lastOrder.status]
      } ${lastOrder.status}`
    }
    break
  }

  case 'check_loyalty': {
    botReply = `🌟 You currently have *${user.loyaltyBalance} loyalty points*.
You can type *"use points"* during your next order to get a discount.`
    break
  }

  case 'update_preferences': {
    const lower = text.toLowerCase()
    const newPrefs = { ...user.preferences }

    if (lower.includes('fragrance')) {
      const match = lower.match(/fragrance\s*(?:to|=)?\s*([a-z]+)/)
      if (match) newPrefs.fragrance = match[1]
    }
    if (lower.includes('fold')) newPrefs.folding = 'neatly folded'
    if (lower.includes('iron')) newPrefs.ironing = 'well ironed'

    user.preferences = newPrefs
    await user.save()

    botReply = `✅ Preferences updated!\n\n📝 Current preferences:\n${Object.entries(
      newPrefs
    )
      .map(([k, v]) => `• ${k}: ${v}`)
      .join('\n')}`
    break
  }

  case 'my_orders': {
    const orders = await Order.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5)

    if (!orders.length) {
      botReply = "📦 You haven't placed any orders yet."
      break
    }

    botReply = `🧾 Your Recent Orders:\n\n${orders
      .map((o, i) => {
        const redeemed =
          o.loyaltyRedeemed > 0 ? `🎁 Redeemed: ₦${o.loyaltyRedeemed}` : ''
        const earned =
          o.loyaltyEarned > 0 ? `⭐ Earned: ${o.loyaltyEarned} pts` : ''
        const extras = [redeemed, earned].filter(Boolean).join(' | ') // join with separator if both exist

        return `${i + 1}. ${STATUS_EMOJIS[o.status] || '📦'} *${o._id
          .toString()
          .slice(-6)
          .toUpperCase()}*\n   • ${DateTime.fromJSDate(o.createdAt).toFormat(
          'dd LLL yyyy'
        )}\n   • ₦${o.price} — ${o.status}${extras ? `\n   • ${extras}` : ''}`
      })
      .join('\n\n')}`
    break
  }

  case 'farewell': {
    const farewellReplies = [
      '👋 Bye! Talk to you soon.',
      '😊 Thanks for chatting with us. Have a great day!',
      '🙌 See you later!',
      "💙 Thank you! We'll be here when you need us again."
    ]
    botReply =
      farewellReplies[Math.floor(Math.random() * farewellReplies.length)]
    break
  }

  default: {
    botReply = await processUserMessage(user._id, text)
  }
}
