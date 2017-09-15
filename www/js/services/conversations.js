angular.module('app.services.conversations', [])

/**
 * Conversations factory performs actions of conversations
 * such as getting conversations, create conversations, make
 * a user to be a member of a conversation and update unread count.
 *
 * This factory also hode a cache of conversations and separated
 * user conversation list of direct or group conversations for
 * fast fetching by the view.
 */
.factory('Conversations', [
  'SkygearChat', 'Skygear', 'Users', '$q', '$rootScope', '$state',
  function(SkygearChat, Skygear, Users, $q, $rootScope, $state) {

    // a cache holding conversations and catagorized direct/group
    // conversaion list.
    const conversations = {
      directConversations: [],
      groupConversations: []
    };

    const cache = function(conversation) {
      conversations[conversation._id] = conversation;
    };

    // helper function for getting the other user id from a direct
    // conversation
    const getOtherUserIdFromDirectConversation = function(conversation) {
      return conversation.participant_ids
      .filter(function(p) {
        return p !== Skygear.auth.currentUser._id;
      });
    };

    // helper function for setting unread count of a user conversation
    // it function will find a user conversation from group and direct
    // conversation list
    const setUnreadCount = function(conversationId, count) {
      conversations.groupConversations.forEach(function(userConversation) {
        if (userConversation._id === conversationId) {
          userConversation.unread_count = count;
        }
      });
      conversations.directConversations.forEach(function(userConversation) {
        if (userConversation._id === conversationId) {
          userConversation.unread_count = count;
        }
      });
    };

    return {
      conversations: conversations,

      // Fetch conversations and categorize them into group and direct
      // conversations. This function will cache conversations and
      // push user conversations to specific list.
      fetchConversations: function() {
        return SkygearChat.getConversations()
        .then(function(userConversations) {
          // Categorize conversations into group conversation and direct
          // conversation
          conversations.directConversations = userConversations
          .filter(function(uc) {
            return uc.distinct_by_participants && uc.participant_ids.length === 2;
          }).map(function(c) {
            const conversation = c;
            conversation.otherUserId = getOtherUserIdFromDirectConversation(
              conversation);
            return conversation;
          });

          conversations.groupConversations = userConversations
          .filter(function(uc) {
            return !uc.distinct_by_participants || uc.participant_ids.length !== 2;
          });

          $rootScope.$apply();

          userConversations.forEach(function(c) {
            cache(c);
          });

          // Fetch users at the same time
          const users = userConversations.reduce(function(prev, curr) {
            return prev.concat(curr.participant_ids);
          }, []);

          return Users.fetchUsers(users)
          .then(function() {
            return userConversations;
          });
        });
      },

      // Getting a single conversation
      fetchConversation: function(conversationId) {
        const deferred = $q.defer();
        const conversation = conversations[conversationId];
        if (conversation) {
          deferred.resolve(conversation);
        } else {
          SkygearChat.getConversation(conversationId)
          .then(function(userConversation) {
            cache(userConversation);

            Users.fetchUsers(userConversation.participant_ids)
            .then(function() {
              deferred.resolve(userConversation);
            });
          });
        }
        return deferred.promise;
      },

      // Create group conversation and push this to group conversation list
      createGroupConversation: function(title) {
        return SkygearChat.createConversation(
          [Skygear.auth.currentUser], title
        ).then(function(conversation) {
          cache(conversation);
          return SkygearChat.getConversation(conversation._id);
        }).then(function(userConversation) {
          conversations.groupConversations.push(userConversation);
          return userConversation;
        }, function(err) {
          console.log('create Conversationfails', err);
        });
      },

      // Add user to a conversation
      addParticipant: function(c, user) {
        return SkygearChat.addParticipants(c, [user])
        .then(function(conversation) {
          console.log('Add participant success', conversation);
          cache(conversation);
          return conversation;
        });
      },

      // Invite other user for direct conversation. It will add a new
      // user conversation to direct conversation list.
      createDirectConversation: function(user, title) {
        return SkygearChat.createDirectConversation(user, title)
        .then(function(conversation) {
          return SkygearChat.getConversation(conversation._id);
        }).then(function(userConversation) {
          const conversation = userConversation;
          conversation.otherUserId = getOtherUserIdFromDirectConversation(
            conversation);
          cache(conversation);
          conversations.directConversations.push(userConversation);
          return userConversation;
        }, function(err) {
          console.log('createDirectConversation fails', err);
        });
      },

      // Update unread count of a conversation, usually called with 0 count
      // when a user start reading a conversation.
      setUnreadCount: function(conversationId, count) {
        setUnreadCount(conversationId, count);
      },

      // This function is called by skygear chat pubsub on conversation update
      // event.
      onConversationUpdated: function(conversation) {
        SkygearChat.getConversation(conversation._id)
        .then(function(userConversation) {
          conversation = userConversation;
          if (conversation.ownerID === Skygear.auth.currentUser._id) {
            return;
          }
          cache(conversation);
          if (conversation.is_direct_message) {
            conversation.otherUserId = getOtherUserIdFromDirectConversation(
              conversation);
            conversations.directConversations.push(userConversation);
          } else {
            conversations.groupConversations.push(userConversation);
          }
          $rootScope.$apply();
        }, function(error) {
          if (conversation.is_direct_message) {
            conversations.directConversations = conversations
            .directConversations.filter(function(us) {
              return us._id !== conversation._id;
            });
          } else {
            conversations.groupConversations = conversations.groupConversations
            .filter(function(us) {
              return us._id !== conversation._id;
            });
          }
          $rootScope.$apply();
        });
      },

      // This function is called by skygear ch pubsub on message create event.
      // This function will set unread count of a user conversation if current
      // user is not reading that conversation.
      onMessageCreated: function(message) {
        const conversationId = message.conversation._id.replace('conversation/', '');
        const conversation = conversations[conversationId];
        const unreadMessageCount = SkygearChat.getUnreadMessageCount(conversation);
        if (conversationId.indexOf($state.params.id) === -1) {
          setUnreadCount(conversationId, unreadMessageCount);
          $rootScope.$apply();
        } else {
          SkygearChat.markAsLastMessageRead(
            conversation, message);
        }
      }
    };
  }
]);
